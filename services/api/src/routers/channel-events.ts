import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { channelId } from "@fizz/core";
import { channelStreamEvent } from "@fizz/api-contract";
import type { AppEnv } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";

const POLL_INTERVAL_MS = 500;
/**
 * Because this project's API Gateway integration is a buffered Lambda proxy (see the handler
 * doc comment below), every event written during a window is only delivered to the client in
 * one lump when the window closes and the Lambda returns — there's no incremental flush. This
 * bounds that worst-case delivery latency; keep it short. Still safely under API Gateway REST
 * API's hard 29s integration timeout.
 */
const MAX_WINDOW_MS = 2_000;

export const channelEventsApp = new OpenAPIHono<AppEnv>();

/**
 * `GET /channels/{id}/events` — polls the per-channel `CHANNEL#<id> / EVENT#<ulid>` append log
 * (written by every mutation via `appendChannelEvent`) for rows newer than the client's cursor and
 * writes each as an SSE frame. Bounded to `MAX_WINDOW_MS` per request rather than held open
 * indefinitely: `hono/aws-lambda`'s `handle()` is a buffered Lambda proxy integration (this project's
 * `@pulumi/aws` version doesn't support the `responseTransferMode`/`InvokeMode: RESPONSE_STREAM`
 * wiring real incremental flushing would need — see infra/README.md), so a single invocation can
 * only ever return one complete response body, not a truly live push. The client reconnects
 * immediately after each window closes, using the last event's id as `Last-Event-ID` — same
 * reconnect-driven delivery as true SSE, just chunked into bounded windows instead of one
 * indefinitely-held connection. If the `@pulumi/aws` gap ever closes, this same handler starts
 * behaving as true indefinite streaming with no code change — the adapter decides how bytes flush.
 */
channelEventsApp.openapi(
  createRoute({
    method: "get",
    path: "/{channelId}/events",
    request: {
      params: z.object({ channelId }),
      headers: z.object({ "last-event-id": z.string().optional() }),
    },
    responses: { 200: { content: { "text/event-stream": { schema: channelStreamEvent } }, description: "OK" } },
  }),
  (c) => {
    const { channelId: id } = c.req.valid("param");
    let cursor = c.req.valid("header")["last-event-id"] ?? "";

    return streamSSE(c, async (stream) => {
      const deadline = Date.now() + MAX_WINDOW_MS;
      while (!stream.aborted && Date.now() < deadline) {
        const res = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: cursor ? "pk = :pk and sk > :sk" : "pk = :pk and begins_with(sk, :prefix)",
            ExpressionAttributeValues: cursor
              ? { ":pk": `CHANNEL#${id}`, ":sk": `EVENT#${cursor}` }
              : { ":pk": `CHANNEL#${id}`, ":prefix": "EVENT#" },
          }),
        );

        for (const item of res.Items ?? []) {
          if (!item.sk.startsWith("EVENT#")) continue;
          await stream.writeSSE({ id: item.cursor, data: JSON.stringify(item.event) });
          cursor = item.cursor;
        }

        await stream.sleep(POLL_INTERVAL_MS);
      }
    });
  },
);
