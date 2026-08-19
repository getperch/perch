import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Channel, Member, Message } from "@perch/core";
import { mentions as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";

export const mentionsApp = new OpenAPIHono<AppEnv>();

/** Same derivation the desktop composer uses for a person's @token (see packages/ui utils
 * `mentionTokenFor`): full name, lowercased, spaces → hyphens. */
function personToken(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PER_CHANNEL_SCAN = 60;
const MAX_RESULTS = 40;

/**
 * Cross-channel feed of messages that @mention the calling user. There's no stored "mention"
 * record — this fans out over the caller's channels, reads each one's most recent messages, and
 * keeps the ones whose text contains `@<token>` for the caller (their full-name token, or their
 * bare first name). `unread` is a heuristic (posted in the last 24h) because the app has no
 * per-user read cursor.
 */
mentionsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listMentionsOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { workspaceId, actorId } = ctxOf(c);

    const [channelsRes, membersRes] = await Promise.all([
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "CHANNEL#" },
        }),
      ),
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "MEMBER#" },
        }),
      ),
    ]);

    const members = (membersRes.Items ?? []).map((i) => i.member as Member);
    const membersById = new Map(members.map((m) => [m.id, m]));
    const me = membersById.get(actorId);
    if (!me) return c.json([]);

    const tokens = new Set<string>([personToken(me.name)]);
    const first = me.name.trim().split(/\s+/)[0];
    if (first) tokens.add(first.toLowerCase());

    const channels = (channelsRes.Items ?? [])
      .map((i) => i.channel as Channel)
      .filter((ch) => ch.memberIds.includes(actorId));

    const perChannel = await Promise.all(
      channels.map(async (ch) => {
        const res = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": `CHANNEL#${ch.id}`, ":prefix": "MSG#" },
            Limit: PER_CHANNEL_SCAN,
            ScanIndexForward: false,
          }),
        );
        return (res.Items ?? [])
          .map((i) => i.message as Message)
          .filter((m) => {
            if (m.isSystem || m.deletedAt || !m.text || m.authorId === actorId) return false;
            const hits = [...m.text.matchAll(/@([A-Za-z0-9][A-Za-z0-9_-]*)/g)].map((x) => x[1]!.toLowerCase());
            return hits.some((h) => tokens.has(h));
          })
          .map((m) => {
            const author = m.authorId ? membersById.get(m.authorId) : undefined;
            return {
              messageId: m.id,
              channelId: ch.id,
              channelName: ch.name,
              authorId: m.authorId,
              authorKind: author?.kind === "agent" ? ("agent" as const) : ("person" as const),
              authorName: author?.name ?? "Unknown",
              authorMono: author?.mono ?? "?",
              text: m.text!,
              createdAt: m.createdAt,
              unread: Date.now() - new Date(m.createdAt).getTime() < DAY_MS,
            };
          });
      }),
    );

    const flat = perChannel
      .flat()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, MAX_RESULTS);

    return c.json(flat);
  },
);
