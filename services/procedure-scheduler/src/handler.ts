import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { z } from "zod";
import type { AgentMember, Procedure } from "@perch/core";

/**
 * The single target of every EventBridge Scheduler schedule this app creates (see
 * infra/schedule.ts). It does one thing: start the right replay/run execution on AgentRuntime.
 * All schedule specifics live in the schedule's own `Input`, set when the schedule is
 * created/updated:
 *  - `{workspaceId, procedureId}` — a Routine (browser replay), by services/api/src/procedures-support.ts
 *  - `{workspaceId, agentId, triggerIndex}` — an agent `{kind:"schedule"}` trigger, by
 *    services/api/src/schedule-support.ts
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "";

const procedureEvent = z.object({ workspaceId: z.string(), procedureId: z.string() });
const scheduleEvent = z.object({ workspaceId: z.string(), agentId: z.string(), triggerIndex: z.number().int().nonnegative() });
const eventSchema = z.union([procedureEvent, scheduleEvent]);

export const handler = async (rawEvent: unknown) => {
  const event = eventSchema.parse(rawEvent);

  if ("procedureId" in event) {
    const { workspaceId, procedureId } = event;
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `PROCEDURE#${procedureId}` } }));
    const procedure = res.Item?.procedure as Procedure | undefined;
    if (!procedure) {
      console.warn(`scheduler: routine ${procedureId} no longer exists — ignoring fire`);
      return { skipped: true };
    }

    const runId = ulid();
    await workflow.start(Resource.AgentRuntime, {
      name: `procedure-${procedureId}-${runId}`,
      payload: {
        kind: "procedure" as const,
        workspaceId,
        procedureId,
        agentId: procedure.agentId,
        runId,
        triggeredBy: `schedule: ${procedure.schedule?.cron ?? "cron"}`,
        actorId: "system",
      },
    });
    return { runId };
  }

  const { workspaceId, agentId, triggerIndex } = event;
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${agentId}` } }));
  const member = res.Item?.member as AgentMember | undefined;
  const trigger = member?.kind === "agent" ? member.config.triggers[triggerIndex] : undefined;
  if (!trigger || trigger.kind !== "schedule" || !trigger.enabled) {
    console.warn(`scheduler: agent ${agentId} schedule #${triggerIndex} is gone or disabled — ignoring fire`);
    return { skipped: true };
  }
  if (!trigger.resolvedChannelId || !trigger.prompt) {
    console.warn(`scheduler: agent ${agentId} schedule #${triggerIndex} has no target channel or prompt — ignoring fire`);
    return { skipped: true };
  }

  const runId = ulid();
  await workflow.start(Resource.AgentRuntime, {
    // Durable-execution names cap at 64 chars — a short prefix + the unique run id stays well under.
    name: `sch-${runId}`,
    payload: {
      kind: "scheduled" as const,
      workspaceId,
      agentId,
      channelId: trigger.resolvedChannelId,
      prompt: trigger.prompt,
      triggeredBy: `schedule: ${trigger.label ?? trigger.schedule ?? "cron"}`,
      actorId: "system",
      runId,
      notifyMemberId: trigger.target?.mode === "dm" ? trigger.target.memberId : undefined,
      // Presence of this is also what tells runScheduled to leave a Tasks-screen row (cron only).
      scheduleLabel: trigger.schedule,
    },
  });
  return { runId };
};
