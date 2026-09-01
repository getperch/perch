import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { z } from "zod";
import type { Procedure } from "@perch/core";

/**
 * The single target of every routine EventBridge Scheduler schedule (see infra/schedule.ts). It
 * does one thing: start the routine's replay execution on AgentRuntime. All schedule specifics —
 * cron, timezone, which routine — are carried in the schedule's own `Input`, set by
 * `services/api/src/routers/procedures.ts` when the schedule is created/updated.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.WORKSPACE_TABLE_NAME ?? "";

const eventSchema = z.object({ workspaceId: z.string(), procedureId: z.string() });

export const handler = async (rawEvent: unknown) => {
  const { workspaceId, procedureId } = eventSchema.parse(rawEvent);

  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `PROCEDURE#${procedureId}` } }));
  const procedure = res.Item?.procedure as Procedure | undefined;
  if (!procedure) {
    console.warn(`procedure-scheduler: routine ${procedureId} no longer exists — ignoring fire`);
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
};
