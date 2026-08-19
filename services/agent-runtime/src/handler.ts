import { workflow } from "sst/aws/workflow";
import { Agent, SessionManager } from "@strands-agents/sdk";
import { addReaction, appendRunStep, checkBudget, completeRun, createRun, loadAgentConfig, postMessage } from "./persist.js";
import { S3KnowledgeStore, memoryEnabled, sessionIdFor, sessionStorage } from "./memory.js";
import { resolveModel } from "./model.js";
import { estimateCostUsd } from "./pricing.js";
import { CONCISENESS_INSTRUCTIONS, TOOL_USE_INSTRUCTIONS, formatAgentResponse } from "./response-schema.js";
import { resolveGrantedTools } from "./mcp-gateways.js";
import { ApprovalInterventionHandler } from "./tools.js";

/**
 * Turns a thrown error into a short line safe to show a user in a channel and on the run page:
 * strips ARNs, 12-digit account ids, `file://` and absolute paths, and `at fn (file:line:col)`
 * stack frames, keeps the first meaningful sentence(s), and caps the length. Most real failures
 * here — model access denied, tool gateway 4xx/5xx, timeouts, malformed responses — carry a
 * useful message that survives this untouched; only infra plumbing detail gets scrubbed.
 */
export function sanitizeRunError(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : String(err ?? "Unexpected error");
  const cleaned = raw
    .replace(/arn:aws[a-z-]*:[^\s"'`)]+/gi, "<resource>")
    .replace(/\b\d{12}\b/g, "<id>")
    .replace(/\bfile:\/\/\S+/gi, "")
    .replace(/(?:\/[\w.@-]+){3,}/g, "<path>")
    .replace(/\n\s*at\s+.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentences = cleaned.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  const out = (firstSentences || cleaned).slice(0, 300).trim();
  return out || "The run stopped on an unexpected error.";
}

export type AgentRunEvent = {
  workspaceId: string;
  channelId: string;
  messageId: string;
  /**
   * "direct": someone specifically @mentioned or assigned this agent — always does the real work.
   * "triage": no one was tagged; this agent independently judges whether the message is relevant
   * to its role (see services/api/src/routers/messages.ts's fan-out to every agent with the
   * "relevant" trigger enabled) before deciding whether to react and respond at all.
   */
  mode: "direct" | "triage";
  agentId: string;
  triggeredBy: string;
  actorId: string;
  /** The channel's name and its "goal"/topic (channel.topic), passed through so the agent knows
   * what the channel it's posting in is for — folded into the system prompt below. */
  channelName?: string;
  channelTopic?: string;
  prompt: string;
};

/** A short system-prompt block describing the channel the agent is working in, so a channel's
 * stated goal actually steers the agents running in it. Empty when nothing useful is known. */
function channelContext(event: AgentRunEvent): string {
  const name = event.channelName ? `#${event.channelName}` : undefined;
  const parts = [name, event.channelTopic?.trim() || undefined].filter(Boolean);
  if (parts.length === 0) return "";
  return `\n\n## The channel you're in\n${parts.join(" — ")}\nKeep your replies relevant to this channel's purpose.`;
}

/**
 * The durable orchestration loop invoked async by services/api (messages.send, via
 * `workflow.start()`) whenever a message @mentions or is assigned to an agent, or — in "triage"
 * mode — once per opted-in agent in the channel for a message that tagged no one. Tool calls now go
 * straight through `McpTool`s obtained from Gateway (see mcp-gateways.ts) instead of a per-call
 * `ctx.invoke()` — a crash/timeout mid-run replays the whole reasoning turn rather than resuming
 * from the last completed tool call (an accepted regression, see the "Unify tool invocation on
 * native AgentCore Gateway MCP" plan's "Explicit, accepted tradeoff" section). Approval-gating is
 * still fully durable: `ApprovalInterventionHandler` (tools.ts) uses `ctx.createCallback()` exactly
 * as before, including the up-to-24h suspend while waiting on a human decision — see
 * sst.dev/docs/component/aws/workflow and docs.aws.amazon.com/durable-execution for the
 * checkpoint/replay model this leans on. Note that `strandsAgent.invoke()` itself must NOT be
 * wrapped in a `ctx.step`: the approval intervention handler calls `ctx.createCallback()`
 * internally (a wait of up to 24h for tool approval), and nesting that durable suspension point
 * inside another step's closure breaks the checkpoint contract — the invocation just hangs
 * instead of ever completing the step.
 */
export const handler: ReturnType<typeof workflow.handler> = workflow.handler(async (event: AgentRunEvent, ctx: workflow.Context) => {
  const agent = await ctx.step("load-agent-config", () => loadAgentConfig(event.workspaceId, event.agentId));

  const budget = await ctx.step("check-budget", () => checkBudget(event.workspaceId, agent));
  if (budget.exceeded) {
    await ctx.step("post-budget-exceeded", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: `⚠️ Skipped this run: ${budget.reason}. Ask a workspace admin to raise the cap to continue.`,
      }),
    );
    return { skipped: true, reason: "budget_exceeded" as const };
  }

  if (event.mode === "triage") {
    const relevant = await ctx.step("triage-relevance", async () => {
      const triageAgent = new Agent({ tools: [], model: resolveModel(agent.config.model), systemPrompt: `${agent.config.instructions}${channelContext(event)}` });
      const verdict = await triageAgent.invoke(
        `A new message was posted in a channel you're in, without @mentioning anyone specifically:\n\n"${event.prompt}"\n\nBased solely on your role, should you respond to it? Reply with exactly one word: YES or NO.`,
      );
      return /^\s*yes\b/i.test(typeof verdict === "string" ? verdict : JSON.stringify(verdict));
    });
    // Not relevant to this agent — no run, no reaction, no reply. This is the common case for
    // most messages in a channel with opted-in agents, so it's deliberately cheap: one short
    // classification call and nothing else.
    if (!relevant) return { skipped: true };
  }

  // Reacts before doing the real work in both modes — this is the only signal a user gets that
  // the agent is running at all, since a reply can take several seconds (model + tool calls).
  await ctx.step("react", () =>
    addReaction({ workspaceId: event.workspaceId, channelId: event.channelId, messageId: event.messageId, memberId: agent.id, emoji: "👍" }),
  );

  const run = await ctx.step("create-run", () =>
    createRun({
      workspaceId: event.workspaceId,
      channelId: event.channelId,
      agentId: agent.id,
      title: event.prompt.slice(0, 80),
      triggeredBy: event.triggeredBy,
    }),
  );

  let strandsAgent: Agent | undefined;
  let disconnectMcpClients: (() => Promise<void>) | undefined;
  try {
    const { tools: mcpTools, grantsByToolName, disconnect } = await resolveGrantedTools(agent.config.tools);
    disconnectMcpClients = disconnect;

    const toolInstructions = mcpTools.length > 0 ? `\n\n${TOOL_USE_INSTRUCTIONS}` : "";
    // Every granted skill's full body rides along in the system prompt unconditionally — no
    // separate resolution step the way tools have, since skills are just more prompt text, not a
    // capability with its own invocation path. See packages/core/src/plugin.ts for how these same
    // docs get published as skills/{name}/SKILL.md files.
    const skillInstructions = agent.config.skills.map((s) => `\n\n## ${s.name}\n${s.body}`).join("");
    const approvalHandler = new ApprovalInterventionHandler(grantsByToolName, ctx, run);

    console.log(`agent-runtime: resolved ${mcpTools.length} tool(s): ${mcpTools.map((t) => `${t.name} (${JSON.stringify(t.description).slice(0, 80)})`).join(", ") || "none"}`);

    // Memory (see memory.ts). Attached to the real agent only — the triage classifier above stays
    // stateless. `SessionManager` restores this (workspace, channel, agent) conversation on init
    // and re-snapshots it after `invoke()`; `memoryManager` adds `search_memory`/`add_memory` over
    // the workspace's OKF knowledge bundle and, with `injection`, folds the top matches into the
    // model input on each user turn. Both no-op cleanly if the memory bucket isn't provisioned yet.
    const memory = memoryEnabled()
      ? {
          sessionManager: new SessionManager({
            sessionId: sessionIdFor(event),
            storage: sessionStorage(),
            saveLatestOn: "invocation" as const,
          }),
          memoryManager: {
            stores: [
              new S3KnowledgeStore({
                workspaceId: event.workspaceId,
                agentHandle: agent.handle,
                model: agent.config.model,
                channelId: event.channelId,
                runId: run.id,
              }),
            ],
            addToolConfig: true,
            injection: true,
          },
        }
      : {};

    strandsAgent = new Agent({
      tools: mcpTools,
      model: resolveModel(agent.config.model),
      systemPrompt: `${agent.config.instructions}${channelContext(event)}\n\n${CONCISENESS_INSTRUCTIONS}${toolInstructions}${skillInstructions}`,
      interventions: [approvalHandler],
      ...memory,
    });

    const reasoningStarted = Date.now();
    const result = await strandsAgent.invoke(event.prompt);
    console.log(`agent-runtime: invoke finished, stopReason=${JSON.stringify(result.stopReason)}`);
    await appendRunStep(run, {
      kind: "reasoning",
      name: "Reasoning",
      durationMs: Date.now() - reasoningStarted,
      startedAt: new Date(reasoningStarted).toISOString(),
    });

    const response = formatAgentResponse(result.toString());

    await ctx.step("post-result", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: response.answer,
        citations: response.sources.map((source, i) => ({ n: i + 1, label: source.label, url: source.url })),
        runId: run.id,
      }),
    );

    const usage = strandsAgent.metrics.latestAgentInvocation?.usage;
    const completed = await ctx.step("complete-run", () =>
      completeRun(run, "completed", usage ? { costUsd: estimateCostUsd(agent.config.model, usage), tokensUsed: usage.totalTokens } : {}),
    );
    return { runId: completed.id };
  } catch (err) {
    // Full stack still only goes to CloudWatch; `reason` is the sanitized version safe to persist
    // and show (see sanitizeRunError).
    console.error(`agent-runtime: run ${run.id} failed:`, err instanceof Error ? err.stack : err);
    const reason = sanitizeRunError(err);
    // Best-effort: the agent loop may have made model calls before throwing (e.g. a tool
    // failure after the reasoning step), so its metrics can still hold real usage worth
    // recording rather than leaving this run's cost silently at 0.
    const usage = strandsAgent?.metrics.latestAgentInvocation?.usage;
    await ctx.step("fail-run", () =>
      completeRun(run, "failed", {
        error: reason,
        ...(usage ? { costUsd: estimateCostUsd(agent.config.model, usage), tokensUsed: usage.totalTokens } : {}),
      }),
    );
    // A failed run is otherwise invisible in the channel — just the 👍 reaction, then silence.
    // Post a visible failure message *with the sanitized reason* so the person who asked can see
    // what actually broke without having to open the run; "View run" (via `runId`) still leads to
    // the full timeline.
    await ctx.step("record-failure-step", () =>
      appendRunStep(run, { kind: "reasoning", name: "Run failed", detail: reason, startedAt: new Date().toISOString() }),
    );
    await ctx.step("post-failure", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: `⚠️ I couldn't finish this: ${reason}`,
        runId: run.id,
      }),
    );
    throw err;
  } finally {
    // Per-run connections (see mcp-gateways.ts) — always tear down, success or failure, mirroring
    // the try/finally client.disconnect() pattern the deleted shim Lambdas used.
    await disconnectMcpClients?.();
  }
});
