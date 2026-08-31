import { CreateScheduleCommand, DeleteScheduleCommand, ListSchedulesCommand, SchedulerClient, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import type { AgentMember, TriggerConfig } from "@perch/core";
import { ddb, TABLE_NAME } from "./db.js";
import { fiveFieldToEventBridgeCron } from "./procedures-support.js";

/**
 * The agent-side counterpart to procedures-support.ts: turns an agent's `{kind:"schedule"}`
 * triggers into EventBridge Scheduler schedules (one per enabled trigger, in the same group the
 * routines use) and resolves each trigger's `target` down to a concrete `resolvedChannelId` so
 * the scheduler Lambda and the "Run now" route never have to. Called on every agent create/update.
 */

const HOME_REGION = process.env.HOME_REGION;
const SCHEDULE_GROUP = process.env.ROUTINE_SCHEDULE_GROUP ?? "";
const SCHEDULER_TARGET_ARN = process.env.ROUTINE_SCHEDULER_FUNCTION_ARN ?? "";
const SCHEDULER_ROLE_ARN = process.env.ROUTINE_SCHEDULER_ROLE_ARN ?? "";

const scheduler = new SchedulerClient({ region: HOME_REGION });

const scheduleName = (agentId: string, triggerIndex: number) => `agent-${agentId}-${triggerIndex}`;

/** `direct` channel whose members are exactly `memberIds` (order-independent), created if absent.
 * Mirrors the finder in routers/channels.ts's `POST /direct`, but takes the full member set
 * explicitly rather than implying the caller. */
export async function getOrCreateDirectChannel(workspaceId: string, memberIds: string[]): Promise<string> {
  const wanted = new Set(memberIds);
  const all = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "CHANNEL#" },
    }),
  );
  const existing = (all.Items ?? [])
    .map((i) => i.channel)
    .find((ch) => ch.kind === "direct" && ch.memberIds.length === wanted.size && ch.memberIds.every((id: string) => wanted.has(id)));
  if (existing) return existing.id;

  const members = await Promise.all(
    [...wanted].map((id) => ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${id}` } }))),
  );
  const names = members.map((m) => (m.Item?.member.name as string | undefined) ?? "?");
  const channel = {
    id: ulid(),
    workspaceId,
    name: names.length <= 1 ? names[0] ?? "Direct" : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`,
    memberIds: [...wanted],
    kind: "direct" as const,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${workspaceId}`, sk: `CHANNEL#${channel.id}`, channel } }));
  return channel.id;
}

/** The concrete channel a schedule trigger posts to: its explicit `target`, or — for a legacy
 * trigger with none — the agent's first `postsInChannelIds`. Returns `undefined` if neither is
 * set (caller surfaces a clear error). */
export async function resolveScheduleChannelId(workspaceId: string, agent: AgentMember, trigger: TriggerConfig): Promise<string | undefined> {
  if (trigger.target?.mode === "channel") return trigger.target.channelId;
  if (trigger.target?.mode === "dm") return getOrCreateDirectChannel(workspaceId, [trigger.target.memberId, agent.id]);
  return agent.config.postsInChannelIds[0];
}

/**
 * Reconcile an agent's schedule triggers with EventBridge. Mutates `agent.config.triggers` in
 * place, stamping each schedule trigger's `resolvedChannelId`, then upserts a schedule for every
 * enabled one and deletes schedules for triggers that are now disabled or gone. Best-effort per
 * trigger — a single bad cron doesn't block the rest or the agent save.
 */
export async function syncAgentSchedules(workspaceId: string, agent: AgentMember): Promise<void> {
  const triggers = agent.config.triggers;

  // Index every schedule trigger and resolve its target channel up front (also self-heals
  // `resolvedChannelId` on rows saved before this ran).
  const scheduleRows: { index: number; trigger: TriggerConfig; channelId?: string }[] = [];
  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i]!;
    if (trigger.kind !== "schedule") continue;
    const channelId = await resolveScheduleChannelId(workspaceId, agent, trigger).catch(() => undefined);
    trigger.resolvedChannelId = channelId;
    scheduleRows.push({ index: i, trigger, channelId });
  }

  const wanted = new Map(scheduleRows.filter((r) => r.trigger.enabled && r.trigger.schedule && r.channelId).map((r) => [scheduleName(agent.id, r.index), r]));

  // Drop every existing `agent-<id>-*` schedule that isn't in `wanted` (disabled, deleted, or
  // reindexed), then upsert the ones that are.
  const existing = await scheduler
    .send(new ListSchedulesCommand({ GroupName: SCHEDULE_GROUP, NamePrefix: `agent-${agent.id}-` }))
    .then((r) => r.Schedules ?? [])
    .catch(() => []);
  await Promise.all(
    existing
      .filter((s) => s.Name && !wanted.has(s.Name))
      .map((s) => scheduler.send(new DeleteScheduleCommand({ Name: s.Name!, GroupName: SCHEDULE_GROUP })).catch(() => {})),
  );

  const existingNames = new Set(existing.map((s) => s.Name));
  for (const [name, row] of wanted) {
    const params = {
      Name: name,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: fiveFieldToEventBridgeCron(row.trigger.schedule!),
      FlexibleTimeWindow: { Mode: "OFF" as const },
      Target: {
        Arn: SCHEDULER_TARGET_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ workspaceId, agentId: agent.id, triggerIndex: row.index }),
      },
    };
    await scheduler
      .send(existingNames.has(name) ? new UpdateScheduleCommand(params) : new CreateScheduleCommand(params))
      .catch((err) => console.error(`syncAgentSchedules: ${name} failed`, err));
  }
}

/** Remove every schedule belonging to an agent (on agent delete). */
export async function deleteAgentSchedules(agentId: string): Promise<void> {
  const existing = await scheduler
    .send(new ListSchedulesCommand({ GroupName: SCHEDULE_GROUP, NamePrefix: `agent-${agentId}-` }))
    .then((r) => r.Schedules ?? [])
    .catch(() => []);
  await Promise.all(existing.map((s) => scheduler.send(new DeleteScheduleCommand({ Name: s.Name!, GroupName: SCHEDULE_GROUP })).catch(() => {})));
}
