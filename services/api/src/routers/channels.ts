import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { channelId, memberId } from "@perch/core";
import { channels as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { emit } from "../events.js";

export const channelsApp = new OpenAPIHono<AppEnv>();

channelsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listChannelsOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "CHANNEL#" },
      }),
    );
    return c.json((res.Items ?? []).map((i) => i.channel));
  },
);

channelsApp.openapi(
  createRoute({
    method: "get",
    path: "/{channelId}",
    request: { params: z.object({ channelId }) },
    responses: { 200: { content: { "application/json": { schema: contract.getChannelOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const { channelId: id } = c.req.valid("param");
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `CHANNEL#${id}` } }));
    if (!res.Item) throw new HTTPException(404, { message: `channel ${id} not found` });
    return c.json(res.Item.channel);
  },
);

channelsApp.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: { body: { content: { "application/json": { schema: contract.createChannelInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.createChannelOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    // The creator is always a member; any explicitly-picked members are folded in and de-duped.
    const memberIds = [...new Set([ctx.actorId, ...(input.memberIds ?? [])])];
    const channel = {
      id: ulid(),
      workspaceId: ctx.workspaceId,
      name: input.name,
      topic: input.topic,
      memberIds,
      kind: "group" as const,
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${channel.id}`, channel } }));
    await emit(ctx, "channel.created", { channelId: channel.id, name: channel.name });
    return c.json(channel);
  },
);

/** Adds an existing workspace member (agent or person) to a channel they're not already in — for
 * when someone's already been created but just isn't in this particular channel yet, as opposed
 * to `POST /members/{people,agents}` which always creates a brand new member record. */
channelsApp.openapi(
  createRoute({
    method: "post",
    path: "/{channelId}/members",
    request: {
      params: z.object({ channelId }),
      body: { content: { "application/json": { schema: contract.addChannelMemberInput.omit({ channelId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.addChannelMemberOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: id } = c.req.valid("param");
    const { memberId: newMemberId } = c.req.valid("json");

    const [channelRes, memberRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } })),
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${newMemberId}` } })),
    ]);
    if (!channelRes.Item) throw new HTTPException(404, { message: `channel ${id} not found` });
    if (!memberRes.Item) throw new HTTPException(404, { message: `member ${newMemberId} not found` });

    const existing = channelRes.Item.channel;
    if (existing.memberIds.includes(newMemberId)) return c.json(existing);

    const channel = { ...existing, memberIds: [...existing.memberIds, newMemberId] };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}`, channel } }));
    await emit(ctx, "channel.member_added", { channelId: id, memberId: newMemberId });
    return c.json(channel);
  },
);

/** Removes a member from a group channel. The member record itself is left alone — this only
 * edits the channel's `memberIds`. Direct channels are out of scope (their membership is fixed). */
channelsApp.openapi(
  createRoute({
    method: "delete",
    path: "/{channelId}/members/{memberId}",
    request: { params: z.object({ channelId, memberId }) },
    responses: { 200: { content: { "application/json": { schema: contract.removeChannelMemberOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: id, memberId: targetId } = c.req.valid("param");

    const channelRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } }));
    if (!channelRes.Item) throw new HTTPException(404, { message: `channel ${id} not found` });
    const existing = channelRes.Item.channel;
    if (existing.kind === "direct") throw new HTTPException(400, { message: "can't change who's in a direct conversation" });
    if (!existing.memberIds.includes(targetId)) return c.json(existing);

    const channel = { ...existing, memberIds: existing.memberIds.filter((m: string) => m !== targetId) };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}`, channel } }));
    await emit(ctx, "channel.member_removed", { channelId: id, memberId: targetId });
    return c.json(channel);
  },
);

channelsApp.openapi(
  createRoute({
    method: "post",
    path: "/direct",
    request: { body: { content: { "application/json": { schema: z.object({ otherMemberIds: z.array(memberId).min(1) }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.getOrCreateDirectOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const actorId = c.get("actorId");
    const { otherMemberIds } = c.req.valid("json");
    const dedupedOtherIds = [...new Set(otherMemberIds)];
    const wantedIds = new Set([actorId, ...dedupedOtherIds]);

    const all = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "CHANNEL#" },
      }),
    );
    const existing = (all.Items ?? [])
      .map((i) => i.channel)
      .find((ch) => ch.kind === "direct" && ch.memberIds.length === wantedIds.size && ch.memberIds.every((id: string) => wantedIds.has(id)));
    if (existing) return c.json(existing);

    const others = await Promise.all(
      dedupedOtherIds.map((id) => ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${id}` } }))),
    );
    const missing = dedupedOtherIds.find((_, i) => !others[i]!.Item);
    if (missing) throw new HTTPException(404, { message: `member ${missing} not found` });
    const otherNames = others.map((o) => o.Item!.member.name as string);

    const channel = {
      id: ulid(),
      workspaceId,
      name: directChannelName(otherNames),
      memberIds: [actorId, ...dedupedOtherIds],
      kind: "direct" as const,
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${workspaceId}`, sk: `CHANNEL#${channel.id}`, channel } }));
    return c.json(channel);
  },
);

/** Edits a group channel's name and/or goal (topic). Direct channels have no editable name. */
channelsApp.openapi(
  createRoute({
    method: "patch",
    path: "/{channelId}",
    request: {
      params: z.object({ channelId }),
      body: { content: { "application/json": { schema: contract.updateChannelInput.omit({ channelId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.updateChannelOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: id } = c.req.valid("param");
    const patch = c.req.valid("json");

    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } }));
    if (!res.Item) throw new HTTPException(404, { message: `channel ${id} not found` });
    if (res.Item.channel.kind === "direct") throw new HTTPException(400, { message: "direct conversations can't be edited" });

    const channel = {
      ...res.Item.channel,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.topic !== undefined ? { topic: patch.topic || undefined } : {}),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}`, channel } }));
    await emit(ctx, "channel.updated", { channelId: id, name: channel.name });
    return c.json(channel);
  },
);

/** Permanently removes a group channel and every message in it. Direct channels are out of scope
 * (they reappear on the next DM). Best-effort message cleanup: the channel row goes first so it
 * stops showing immediately, then its MSG# rows are batch-deleted. */
channelsApp.openapi(
  createRoute({
    method: "delete",
    path: "/{channelId}",
    request: { params: z.object({ channelId }) },
    responses: { 200: { content: { "application/json": { schema: contract.deleteChannelOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: id } = c.req.valid("param");
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } }));
    if (!res.Item) throw new HTTPException(404, { message: `channel ${id} not found` });
    if (res.Item.channel.kind === "direct") throw new HTTPException(400, { message: "direct conversations can't be deleted" });

    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } }));

    const msgs = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `CHANNEL#${id}`, ":prefix": "MSG#" },
        ProjectionExpression: "sk",
      }),
    );
    await Promise.all(
      (msgs.Items ?? []).map((m) => ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: `CHANNEL#${id}`, sk: m.sk } }))),
    );

    await emit(ctx, "channel.deleted", { channelId: id, name: res.Item.channel.name });
    return c.json({ deleted: true as const });
  },
);

/** "Alice" for one other member, "Alice & Bob" for two, "Alice, Bob & Rich" for 3+. */
function directChannelName(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
