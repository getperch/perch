import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import type { AuditEventType } from "@perch/core";
import type { ChannelStreamEventInput } from "@perch/api-contract";
import { ddb, TABLE_NAME } from "./db.js";
import type { Context } from "./context.js";

const eventBridge = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "workspace-bus";

/**
 * Every mutation calls this once: it fans out to (1) the audit trail via EventBridge, which
 * `services/audit-writer` hash-chains into the S3 Object Lock bucket, and (2) a per-channel
 * append-only row that `GET /channels/{id}/events` tails to serve the live SSE stream.
 */
export async function emit(ctx: Context, type: AuditEventType, data: Record<string, unknown>) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: "workspace.api",
          DetailType: type,
          Detail: JSON.stringify({
            id: ulid(),
            workspaceId: ctx.workspaceId,
            type,
            actorId: ctx.actorId,
            data,
            occurredAt: new Date().toISOString(),
          }),
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
