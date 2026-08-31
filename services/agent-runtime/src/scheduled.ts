import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { Agent, SessionManager } from "@strands-agents/sdk";
import type { workflow } from "sst/aws/workflow";
import { ddb, TABLE_NAME } from "./db.js";
import { appendChannelEvent } from "./events.js";
import { appendRunStep, checkBudget, completeRun, createRun, loadAgentConfig, postMessage } from "./persist.js";
import { S3KnowledgeStore, memoryEnabled, sessionIdFor, sessionStorage } from "./memory.js";
import { resolveModel } from "./model.js";
import { estimateCostUsd } from "./pricing.js";
import { CONCISENESS_INSTRUCTIONS, TOOL_USE_INSTRUCTIONS, formatAgentResponse } from "./response-schema.js";
import { resolveGrantedTools } from "./mcp-gateways.js";
import { ApprovalInterventionHandler } from "./tools.js";
import { A2UI_INSTRUCTIONS, makeRenderUiTool } from "./a2ui.js";
import { sanitizeRunError } from "./sanitize.js";

/**
 * A scheduled agent run — a `{kind:"schedule"}` trigger on an agent's config firing, either on its
 * cron (via the scheduler Lambda) or from the Schedules list's "Run now". Unlike the message path
 * in handler.ts there's no triggering message to react to and no triage step: it just runs the
 * assigned agent's reasoning loop against the trigger's standing `prompt`, reusing that agent's
 * exact tool grants and model, and posts the answer to `channelId` (a named channel or a 1:1 DM,
 * already resolved by the API — see services/api/src/schedule-support.ts).
 */
export type ScheduledRunEvent = {
  kind: "scheduled";
  workspaceId: string;
  agentId: string;
  /** the channel (or resolved DM channel) the result is posted to */
  channelId: string;
  /** the schedule trigger's standing instruction */
  prompt: string;
  /** "schedule: <label>" for a cron fire, "run now: <label>" for a manual one */
  triggeredBy: string;
  /** "system" for a cron fire, the requesting user's id for "Run now" */
  actorId: string;
  /** pre-allocated by `POST /agents/{id}/schedules/{index}/run` so it can return immediately */
  runId?: string;
  /** person to @mention at the top of the result so they get a mention notification — the DM
   * recipient for a `dm` target. Omitted for a channel target. */
  notifyMemberId?: string;
  /** the trigger's cron, shown as the chip on the Tasks-screen row a cron fire leaves behind.
   * Only set (and only a task written) for a scheduled fire, not a manual "Run now". */
  scheduleLabel?: string;
};

/** Leaves a row in the Tasks screen so a cron fire is visible there, not just in the channel —
 * mirrors `writeScheduleTask` in procedure.ts. Only for scheduled fires; a manual run already has
 * the run view. */
async function writeScheduleTask(
  event: ScheduledRunEvent,
  agentId: string,
  runId: string,
  status: "done" | "declined",
): Promise<void> {
  if (!event.scheduleLabel) return;
  const now = new Date().toISOString();
  const task = {
    id: ulid(),
    workspaceId: event.workspaceId,
    channelId: event.channelId,
    ownerId: agentId,
    openedById: agentId,
    title: event.prompt.slice(0, 80),
    status,
    detail: status === "done" ? "Scheduled agent run." : "Scheduled agent run — failed.",
    source: "schedule" as const,
    runId,
    scheduleLabel: event.scheduleLabel,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${event.workspaceId}`, sk: `TASK#${task.id}`, task } }));
  await appendChannelEvent(event.channelId, { type: "task.created", channelId: event.channelId, task });
}

/** Same token derivation the Mentions feed and the desktop composer use for a person's @handle:
 * full name, lowercased, spaces → hyphens. */
function personToken(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

async function mentionPrefixFor(workspaceId: string, memberId: string | undefined): Promise<string> {
  if (!memberId) return "";
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${memberId}` } })).catch(() => undefined);
  const name = res?.Item?.member?.name as string | undefined;
  return name ? `@${personToken(name)} ` : "";
}

export async function runScheduled(event: ScheduledRunEvent, ctx: workflow.Context): Promise<{ runId: string; skipped?: true }> {
  const agent = await ctx.step("load-agent-config", () => loadAgentConfig(event.workspaceId, event.agentId));

  const budget = await ctx.step("check-budget", () => checkBudget(event.workspaceId, agent));
  if (budget.exceeded) {
    await ctx.step("post-budget-exceeded", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: `⚠️ Skipped this scheduled run: ${budget.reason}. Ask a workspace admin to raise the cap to continue.`,
      }),
    );
    return { runId: event.runId ?? "", skipped: true };
  }

  const run = await ctx.step("create-run", () =>
    createRun({
      workspaceId: event.workspaceId,
      channelId: event.channelId,
      agentId: agent.id,
      title: event.prompt.slice(0, 80),
      triggeredBy: event.triggeredBy,
      runId: event.runId,
    }),
  );

  let strandsAgent: Agent | undefined;
  let disconnectMcpClients: (() => Promise<void>) | undefined;
  try {
    const { tools: mcpTools, grantsByToolName, disconnect } = await resolveGrantedTools(agent.config.tools);
    disconnectMcpClients = disconnect;

    const toolInstructions = mcpTools.length > 0 ? `\n\n${TOOL_USE_INSTRUCTIONS}` : "";
    const skillInstructions = agent.config.skills.map((s) => `\n\n## ${s.name}\n${s.body}`).join("");
    const approvalHandler = new ApprovalInterventionHandler(grantsByToolName, ctx, run);

    console.log(
      `agent-runtime: scheduled run ${run.id} — resolved ${mcpTools.length} tool(s): ${mcpTools.map((t) => t.name).join(", ") || "none"}`,
    );

    const memory = memoryEnabled()
      ? {
          sessionManager: new SessionManager({
            // A scheduled run is its own recurring thread, NOT a continuation of the interactive
            // chat/DM in this channel — sharing that session made the model parrot whatever it
            // last said there (e.g. a pre-fix "I don't have a web search tool" turn), instead of
            // just doing the task. `schedule_` prefix keeps it a separate lineage.
            sessionId: `schedule_${sessionIdFor({ workspaceId: event.workspaceId, channelId: event.channelId, agentId: agent.id })}`,
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

    // `render_ui` — same standard UI-rendering capability the interactive path gets, subject to the
    // same `config.ui.enabled` switch (see handler.ts and services/agent-runtime/src/a2ui.ts).
    const uiEnabled = agent.config.ui?.enabled !== false;
    strandsAgent = new Agent({
      tools: uiEnabled ? [...mcpTools, makeRenderUiTool(run)] : mcpTools,
      model: resolveModel(agent.config.model),
      systemPrompt: `${agent.config.instructions}\n\n${CONCISENESS_INSTRUCTIONS}${toolInstructions}${skillInstructions}${uiEnabled ? `\n\n${A2UI_INSTRUCTIONS}` : ""}`,
      interventions: [approvalHandler],
      ...memory,
    });

    const reasoningStarted = Date.now();
    const result = await strandsAgent.invoke(event.prompt);
    console.log(`agent-runtime: scheduled invoke finished, stopReason=${JSON.stringify(result.stopReason)}`);
    await appendRunStep(run, {
      kind: "reasoning",
      name: "Reasoning",
      durationMs: Date.now() - reasoningStarted,
      startedAt: new Date(reasoningStarted).toISOString(),
    });

    const response = formatAgentResponse(result.toString());
    const mentionPrefix = await mentionPrefixFor(event.workspaceId, event.notifyMemberId);
    await ctx.step("post-result", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: `${mentionPrefix}${response.answer}`,
        citations: response.sources.map((source, i) => ({ n: i + 1, label: source.label, url: source.url })),
        runId: run.id,
      }),
    );

    const usage = strandsAgent.metrics.latestAgentInvocation?.usage;
    const completed = await ctx.step("complete-run", () =>
      completeRun(run, "completed", usage ? { costUsd: estimateCostUsd(agent.config.model, usage), tokensUsed: usage.totalTokens } : {}),
    );
    await ctx.step("write-schedule-task", () => writeScheduleTask(event, agent.id, run.id, "done"));
    return { runId: completed.id };
  } catch (err) {
    console.error(`agent-runtime: scheduled run ${run.id} failed:`, err instanceof Error ? err.stack : err);
    const reason = sanitizeRunError(err);
    const usage = strandsAgent?.metrics.latestAgentInvocation?.usage;
    await ctx.step("fail-run", () =>
      completeRun(run, "failed", {
        error: reason,
        ...(usage ? { costUsd: estimateCostUsd(agent.config.model, usage), tokensUsed: usage.totalTokens } : {}),
      }),
    );
    await ctx.step("record-failure-step", () =>
      appendRunStep(run, { kind: "reasoning", name: "Run failed", detail: reason, startedAt: new Date().toISOString() }),
    );
    await ctx.step("post-failure", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId: event.channelId,
        authorId: agent.id,
        text: `⚠️ I couldn't finish this scheduled run: ${reason}`,
        runId: run.id,
      }),
    );
    await ctx.step("write-schedule-task-failed", () => writeScheduleTask(event, agent.id, run.id, "declined"));
    throw err;
  } finally {
    await disconnectMcpClients?.();
  }
}
