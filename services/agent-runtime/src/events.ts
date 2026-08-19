import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import type { AuditEventType } from "@perch/core";
import type { ChannelStreamEventInput } from "@perch/api-contract";
import { ddb, TABLE_NAME } from "./db.js";

/** Mirrors services/api/src/events.ts — kept as a small local copy rather than a shared runtime
 * dependency so the API and the agent runtime stay independently deployable Lambdas. */

const eventBridge = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "workspace-bus";

export async function emit(workspaceId: string, actorId: string, type: AuditEventType, data: Record<string, unknown>) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: "workspace.agent-runtime",
          DetailType: type,
          Detail: JSON.stringify({ id: ulid(), workspaceId, type, actorId, data, occurredAt: new Date().toISOString() }),
        },
      ],
    }),
  );
}

export async function appendChannelEvent(channelId: string, event: ChannelStreamEventInput) {
  const cursor = ulid();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `CHANNEL#${channelId}`, sk: `EVENT#${cursor}`, cursor, event: { ...event, cursor } },
    }),
  );
  return cursor;
}
