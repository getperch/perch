import { CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { TriggerConfig } from "@perch/core";
import { ddb, TABLE_NAME } from "./db.js";

/**
 * Lets an agent schedule its own one-time reminder mid-conversation — "remind me to pick that up
 * this afternoon" — without a human ever opening Settings → Schedules. Appends one
 * `{kind:"schedule", runAt}` trigger to the agent's own config (same shape a human's recurring
 * cron schedule uses — see packages/core/src/member.ts's `triggerConfig` and
 * services/api/src/schedule-support.ts) and creates exactly one EventBridge Scheduler `at()`
 * schedule for it, named the same way `schedule-support.ts` names every other trigger's schedule
 * (`agent-<id>-<index>`) so it shows up in the Schedules list like any other, and so
 * services/procedure-scheduler's handler — which only knows `{workspaceId, agentId,
 * triggerIndex}` — fires it exactly the same way.
 *
 * Deliberately NOT `services/api/src/schedule-support.ts`'s full `syncAgentSchedules` reconcile —
 * that diffs every trigger against every existing EventBridge schedule, which is the right shape
 * for "a human just edited Settings" but overkill (and an extra full table+API scan) for "append
 * one new trigger and create one new schedule". There's no shared package between services/api
 * and services/agent-runtime (same convention as services/tools/*'s duplicated github-token.ts/
 * google-token.ts) — this is the agent-runtime-side counterpart, not a shortcut.
 */
const HOME_REGION = process.env.HOME_REGION;
const SCHEDULE_GROUP = process.env.ROUTINE_SCHEDULE_GROUP ?? "";
const SCHEDULER_TARGET_ARN = process.env.ROUTINE_SCHEDULER_FUNCTION_ARN ?? "";
const SCHEDULER_ROLE_ARN = process.env.ROUTINE_SCHEDULER_ROLE_ARN ?? "";

const scheduler = new SchedulerClient({ region: HOME_REGION });

export type CreateReminderInput = {
  workspaceId: string;
  agentId: string;
  /** the channel this reminder's run posts its result to — always the channel the reminder was
   * asked for in, so no `resolveScheduleChannelId` DM lookup is needed the way a human-authored
   * trigger sometimes requires. */
  channelId: string;
  /** ISO 8601 date-time, no offset — validated/parsed by the tool caller (see reminder-tool.ts)
   * before this is called. */
  runAt: string;
  /** becomes the scheduled run's prompt — what the agent says/does when the reminder fires. */
  message: string;
};

export async function createReminder(input: CreateReminderInput): Promise<{ triggerIndex: number }> {
  if (!SCHEDULE_GROUP || !SCHEDULER_TARGET_ARN || !SCHEDULER_ROLE_ARN) {
    throw new Error("create_reminder: routine scheduling isn't configured on this deploy — check infra/api.ts's agentRuntime env vars");
  }

  const key = { pk: `WORKSPACE#${input.workspaceId}`, sk: `MEMBER#${input.agentId}` };
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  const member = res.Item?.member;
  if (!member || member.kind !== "agent") throw new Error(`create_reminder: agent ${input.agentId} not found`);

  const trigger: TriggerConfig = {
    kind: "schedule",
    enabled: true,
    runAt: input.runAt,
    label: `Reminder: ${input.message.slice(0, 60)}`,
    prompt: input.message,
    target: { mode: "channel", channelId: input.channelId },
    resolvedChannelId: input.channelId,
  };
  const triggerIndex = member.config.triggers.length;
  member.config.triggers.push(trigger);
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key, member } }));

  const name = `agent-${input.agentId}-${triggerIndex}`;
  await scheduler.send(
    new CreateScheduleCommand({
      Name: name,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: `at(${input.runAt})`,
      // Vanish from EventBridge once it fires — see schedule-support.ts's identical reasoning for
      // why this must NOT apply to a recurring cron schedule (it doesn't; this path only ever
      // creates `at()` schedules).
      ActionAfterCompletion: "DELETE",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: SCHEDULER_TARGET_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ workspaceId: input.workspaceId, agentId: input.agentId, triggerIndex }),
      },
    }),
  );

  return { triggerIndex };
}
