import { InterventionActions, InterventionHandler, type BeforeToolCallEvent, type AfterToolCallEvent, type ToolResultBlock } from "@strands-agents/sdk";
import type { workflow } from "sst/aws/workflow";
import type { Run, ToolGrant } from "@perch/core";
import { appendRunStep, createApproval, postMessage } from "./persist.js";

type DurableContext = workflow.Context;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A tool's result, unlike its structured JSON content pre-Gateway-migration, arrives as MCP
 * `ToolResultContent[]` blocks (see `@strands-agents/sdk`'s `McpTool`, which maps the raw MCP
 * `tools/call` response into `ToolResultBlock`s). The one thing anything downstream of a tool call
 * still cares about pulling out of that — the browser tool's AgentCore session recording URL (see
 * services/tools/browser-agentcore) — can show up either as a `jsonBlock`'s parsed `json` value or
 * as a `textBlock` whose `text` is itself a JSON string, depending on how the underlying Lambda's
 * response got mapped; check both rather than assuming one shape.
 */
function extractRecordingUrl(result: ToolResultBlock): string | undefined {
  for (const block of result.content) {
    if (block.type === "jsonBlock" && isRecord(block.json) && typeof block.json.recordingUrl === "string") {
      return block.json.recordingUrl;
    }
    if (block.type === "textBlock") {
      try {
        const parsed: unknown = JSON.parse(block.text);
        if (isRecord(parsed) && typeof parsed.recordingUrl === "string") return parsed.recordingUrl;
      } catch {
        // Not JSON — plenty of tool results are plain text, nothing to extract.
      }
    }
  }
  return undefined;
}

/**
 * The one place approval-gating (`ToolGrant.needsApproval`) lives now that tool calls go straight
 * through `McpTool` instances obtained from `McpClient.listTools()` (see mcp-gateways.ts) instead
 * of custom per-grant Strands `tool()` wrappers. `@strands-agents/sdk`'s `InterventionHandler`
 * fires `beforeToolCall`/`afterToolCall` generically for *any* tool call, including `McpTool`s, so
 * this single handler replaces what used to be N per-tool closures around `requestApproval()` and
 * the post-call `appendRunStep` in the old `makeStrandsTool` — same behavior, just relocated and
 * shared across every tool regardless of which Gateway it lives on.
 *
 * `beforeToolCall` ports the exact approval flow that used to live in this file's own
 * `requestApproval()` (now a free function below, unchanged): `ctx.createCallback()` +
 * `appendRunStep` (`approval_wait`) + `createApproval()` + `postMessage()` with the approval block,
 * then `proceed()`/`deny(reason)` based on the human's decision.
 *
 * `afterToolCall` ports the old `makeStrandsTool`'s post-call `appendRunStep` (`tool_call`,
 * `detail`, `durationMs`, `recordingUrl`). `AfterToolCallEvent` carries no duration itself, so the
 * call's start time is tracked here in `beforeToolCall` (keyed by `toolUse.toolUseId`, the
 * model-issued correlation key that's stable across the before/after pair) and the elapsed time is
 * computed when `afterToolCall` fires.
 */
export class ApprovalInterventionHandler extends InterventionHandler {
  readonly name = "approval-gate";
  private readonly callStartedAt = new Map<string, number>();
  private readonly deniedCalls = new Set<string>();

  constructor(
    private readonly grantsByToolName: Map<string, ToolGrant>,
    private readonly ctx: DurableContext,
    private readonly run: Run,
  ) {
    super();
  }

  // Explicit return type: `Proceed`/`Deny` aren't exported from `@strands-agents/sdk`'s public
  // package root (only reachable internally, via `./interventions/index.js`, which has no public
  // subpath export) — tsc can't name the inferred union without one, so it's spelled out here via
  // `InterventionActions.proceed`/`.deny`'s own return types instead of importing the hidden names.
  override async beforeToolCall(
    event: BeforeToolCallEvent,
  ): Promise<ReturnType<typeof InterventionActions.proceed> | ReturnType<typeof InterventionActions.deny>> {
    this.callStartedAt.set(event.toolUse.toolUseId, Date.now());

    const grant = this.grantsByToolName.get(event.toolUse.name);
    const modelArgs = event.toolUse.input;
    console.log(`agent-runtime: model called tool "${event.toolUse.name}" with args ${JSON.stringify(modelArgs).slice(0, 300)}`);

    if (!grant?.needsApproval) {
      this.injectReservedContext(grant, event);
      return InterventionActions.proceed();
    }

    // Captured from the model's real args, before injectReservedContext below adds the
    // internal `__workspaceId`/`__agentId`/`__runId` keys — the human approving this call
    // shouldn't see those in the "Requested with: ..." detail text.
    const decision = await requestApproval(this.ctx, this.run, grant.toolName, modelArgs);
    this.injectReservedContext(grant, event);
    if (decision !== "approved") {
      this.deniedCalls.add(event.toolUse.toolUseId);
      return InterventionActions.deny(`${grant.toolName} was declined`);
    }
    return InterventionActions.proceed();
  }

  // The deleted services/tools/gateway-caller shim used to inject these reserved
  // double-underscore-prefixed keys onto the flat event it handed each tool Lambda —
  // gmail/calendar need `__workspaceId`/`__agentId` (per-agent Google connection lookup), browser
  // needs `__runId` (keys its reused AgentCore browser session). Now that Gateway invokes those
  // Lambdas directly with no shim in between, `beforeToolCall` is the one place left with both the
  // run's identity and a guaranteed look at every tool call before it's dispatched — `toolUse.input`
  // is documented as mutable here. web_search has no Lambda of its own (AWS's managed connector)
  // and doesn't expect these keys, so it's excluded.
  private injectReservedContext(grant: ToolGrant | undefined, event: BeforeToolCallEvent): void {
    if (!grant || grant.toolName === "web_search") return;
    event.toolUse.input = {
      ...(isRecord(event.toolUse.input) ? event.toolUse.input : {}),
      __workspaceId: this.run.workspaceId,
      __agentId: this.run.agentId,
      __runId: this.run.id,
    };
  }

  override async afterToolCall(event: AfterToolCallEvent): Promise<ReturnType<typeof InterventionActions.proceed>> {
    const started = this.callStartedAt.get(event.toolUse.toolUseId);
    this.callStartedAt.delete(event.toolUse.toolUseId);

    // A denied call never reaches the tool at all — the SDK's executor still fires
    // afterToolCall for it (with a synthetic error-status result but no `event.error`, since it's
    // a hook-level cancel, not a thrown exception), so it has to be tracked separately here to
    // avoid logging a decline as if the tool had actually run.
    const wasDenied = this.deniedCalls.delete(event.toolUse.toolUseId);
    console.log(
      `agent-runtime: tool "${event.toolUse.name}" finished — error=${event.error ? event.error.message : "none"} denied=${wasDenied} result.status=${event.result.status}`,
    );

    // A thrown/errored tool call skips the step record entirely, matching the old
    // ctx.invoke()-based flow — there, a thrown error propagated straight out of makeStrandsTool's
    // callback and the post-call appendRunStep below it never ran, leaving handler.ts's own
    // try/catch (which records the run itself as failed and posts a visible failure message) as
    // the only place that failure got recorded.
    if (!event.error && !wasDenied) {
      const grant = this.grantsByToolName.get(event.toolUse.name);
      const ms = started !== undefined ? Date.now() - started : 0;
      // Drop the reserved `__`-prefixed keys injectReservedContext added (`__workspaceId`,
      // `__agentId`, `__runId`) — internal routing context, not model args, and this `detail`
      // string is persisted to the run log and shown in the UI.
      const modelArgs = isRecord(event.toolUse.input)
        ? Object.fromEntries(Object.entries(event.toolUse.input).filter(([k]) => !k.startsWith("__")))
        : event.toolUse.input;
      await appendRunStep(this.run, {
        kind: "tool_call",
        name: grant?.toolName ?? event.toolUse.name,
        detail: JSON.stringify(modelArgs).slice(0, 200),
        durationMs: ms,
        startedAt: new Date(started ?? Date.now()).toISOString(),
        recordingUrl: extractRecordingUrl(event.result),
      });
    }

    return InterventionActions.proceed();
  }
}

async function requestApproval(ctx: DurableContext, run: Run, toolName: string, args: unknown) {
  const [callbackPromise, callbackId] = await ctx.createCallback<{ decision: "approved" | "denied" }>(`approval-${toolName}`, {
    timeout: { hours: 24 },
  });

  await appendRunStep(run, {
    kind: "approval_wait",
    name: `${toolName} — waiting for approval`,
    startedAt: new Date().toISOString(),
  });

  const approval = await createApproval({
    workspaceId: run.workspaceId,
    channelId: run.channelId,
    runId: run.id,
    toolName,
    title: `${toolName} needs approval`,
    detail: `Requested with: ${JSON.stringify(args).slice(0, 300)}`,
    callbackToken: callbackId,
  });

  await postMessage({
    workspaceId: run.workspaceId,
    channelId: run.channelId,
    authorId: run.agentId,
    runId: run.id,
    approval: { approvalId: approval.id, title: approval.title, detail: approval.detail, status: "pending" },
  });

  // Suspends here — no compute billed — until services/api's approvals.resolve mutation calls
  // SendDurableExecutionCallbackSuccess with this callbackId.
  const outcome = await callbackPromise;
  return outcome.decision;
}
