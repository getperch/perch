import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import type { AgentMember, Approval, Citation, Message, Run, RunStep, Workspace } from "@perch/core";
import { ddb, TABLE_NAME } from "./db.js";
import { appendChannelEvent, emit } from "./events.js";

/** `agentId` is always a resolved id by the time this is called — services/api/src/routers/
 * messages.ts resolves any @mention against real agent handles before invoking, so there's no
 * handle-lookup fallback to carry here. */
export async function loadAgentConfig(workspaceId: string, agentId: string): Promise<AgentMember> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${agentId}` } }));
  if (!res.Item || res.Item.member.kind !== "agent") throw new Error(`agent ${agentId} not found`);
  return res.Item.member;
}

export async function createRun(input: { workspaceId: string; channelId: string; agentId: string; title: string; triggeredBy: string; runId?: string }): Promise<Run> {
  const run: Run = {
    id: input.runId ?? ulid(),
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    agentId: input.agentId,
    status: "running",
    title: input.title,
    triggeredBy: input.triggeredBy,
    costUsd: 0,
    tokensUsed: 0,
    startedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${input.workspaceId}`, sk: `RUN#${run.id}`, run } }));
  await appendChannelEvent(input.channelId, { type: "run.updated", channelId: input.channelId, run });
  await emit(input.workspaceId, input.agentId, "run.started", { runId: run.id });
  return run;
}

/** Sum of `costUsd` across today's (UTC) runs for the workspace, overall and per agent — the
 * basis for both the `/workspace/spend` endpoint and the pre-run budget check below. Runs share
 * their workspace's `pk`, so this is a single query filtered client-side by `startedAt`; workspace
 * run volume is low enough (agent-triggered, not per-message) that this doesn't need a dedicated
 * daily-total counter item. */
export async function getWorkspaceSpendToday(workspaceId: string): Promise<{ totalUsd: number; byAgentUsd: Record<string, number> }> {
  const todayStart = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD", UTC day boundary
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "RUN#" },
    }),
  );
  const runsToday: Run[] = (res.Items ?? []).map((i) => i.run).filter((run: Run) => run.startedAt.slice(0, 10) === todayStart);

  const byAgentUsd: Record<string, number> = {};
  let totalUsd = 0;
  for (const run of runsToday) {
    totalUsd += run.costUsd;
    byAgentUsd[run.agentId] = (byAgentUsd[run.agentId] ?? 0) + run.costUsd;
  }
  return { totalUsd, byAgentUsd };
}

/** Checked once per run, before any model call — both the workspace-wide and the agent's own
 * daily cap must have room, otherwise the run is skipped entirely (see handler.ts) rather than
 * started and left to fail partway through. Spend already incurred today doesn't include the run
 * about to start, so this stops the *next* run once today's total has reached the cap — a single
 * already-running run can still push the total past the cap before its own cost is recorded. */
export async function checkBudget(workspaceId: string, agent: AgentMember): Promise<{ exceeded: boolean; reason?: string }> {
  const [workspaceRes, spend] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: "META" } })),
    getWorkspaceSpendToday(workspaceId),
  ]);
  const workspace: Workspace | undefined = workspaceRes.Item?.workspace;

  if (workspace && spend.totalUsd >= workspace.spendCapUsdPerDay) {
    return {
      exceeded: true,
      reason: `workspace daily spend cap of $${workspace.spendCapUsdPerDay.toFixed(2)} reached ($${spend.totalUsd.toFixed(2)} spent today)`,
    };
  }

  const agentSpentToday = spend.byAgentUsd[agent.id] ?? 0;
  if (agentSpentToday >= agent.config.dailySpendCapUsd) {
    return {
      exceeded: true,
      reason: `${agent.name}'s daily spend cap of $${agent.config.dailySpendCapUsd.toFixed(2)} reached ($${agentSpentToday.toFixed(2)} spent today)`,
    };
  }

  return { exceeded: false };
}

export async function appendRunStep(run: Run, step: Omit<RunStep, "id" | "runId">) {
  const full: RunStep = { ...step, id: ulid(), runId: run.id };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `RUN#${run.id}`, sk: `STEP#${full.id}`, step: full } }));
  await appendChannelEvent(run.channelId, { type: "run.step", channelId: run.channelId, step: full });
  await emit(run.workspaceId, run.agentId, "run.step", { runId: run.id, stepId: full.id, kind: full.kind });
  return full;
}

export async function completeRun(run: Run, status: "completed" | "failed", updates: Partial<Run> = {}) {
  const updated: Run = { ...run, ...updates, status, completedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${run.workspaceId}`, sk: `RUN#${run.id}`, run: updated } }));
  await appendChannelEvent(run.channelId, { type: "run.updated", channelId: run.channelId, run: updated });
  await emit(run.workspaceId, run.agentId, status === "completed" ? "run.completed" : "run.failed", { runId: run.id });
  return updated;
}

export async function postMessage(input: {
  workspaceId: string;
  channelId: string;
  authorId: string;
  text?: string;
  runId?: string;
  tools?: { name: string; arg: string; ms: number }[];
  citations?: Citation[];
  approval?: { approvalId: string; title: string; detail: string; status: "pending" | "approved" | "denied" };
}) {
  const message = {
    id: ulid(),
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    authorId: input.authorId,
    isSystem: false,
    text: input.text,
    runId: input.runId,
    tools: input.tools ?? [],
    citations: input.citations ?? [],
    reactions: [],
    approval: input.approval,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${input.channelId}`, sk: `MSG#${message.id}`, message } }));
  await appendChannelEvent(input.channelId, { type: "message.created", channelId: input.channelId, message });
  await emit(input.workspaceId, input.authorId, "message.sent", { messageId: message.id, channelId: input.channelId });
  return message;
}

/** Idempotent: a repeat `(memberId, emoji)` pair is a no-op. Used by the triage step in
 * handler.ts to acknowledge a message before doing the real work. */
export async function addReaction(input: { workspaceId: string; channelId: string; messageId: string; memberId: string; emoji: string }): Promise<Message> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `CHANNEL#${input.channelId}`, sk: `MSG#${input.messageId}` } }));
  if (!res.Item) throw new Error(`message ${input.messageId} not found`);

  const existing: Message = res.Item.message;
  const already = existing.reactions.some((r) => r.memberId === input.memberId && r.emoji === input.emoji);
  const message: Message = already ? existing : { ...existing, reactions: [...existing.reactions, { emoji: input.emoji, memberId: input.memberId }] };

  if (!already) {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${input.channelId}`, sk: `MSG#${input.messageId}`, message } }));
  }
  await appendChannelEvent(input.channelId, { type: "message.updated", channelId: input.channelId, message });
  await emit(input.workspaceId, input.memberId, "message.reacted", { messageId: input.messageId, emoji: input.emoji });
  return message;
}

export async function createApproval(input: { workspaceId: string; channelId: string; runId: string; toolName: string; title: string; detail: string; callbackToken: string }): Promise<Approval> {
  const approval: Approval = {
    id: ulid(),
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    runId: input.runId,
    toolName: input.toolName,
    title: input.title,
    detail: input.detail,
    status: "pending",
    callbackToken: input.callbackToken,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${input.workspaceId}`, sk: `APPROVAL#${approval.id}`, approval } }));
  await appendChannelEvent(input.channelId, { type: "approval.updated", channelId: input.channelId, approval });
  await emit(input.workspaceId, "system", "approval.requested", { approvalId: approval.id, runId: input.runId, toolName: input.toolName });
  return approval;
}
