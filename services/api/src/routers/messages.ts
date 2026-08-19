import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Member, Message } from "@fizz/core";
import { channelId, humanActor, messageId } from "@fizz/core";
import { messages as contract } from "@fizz/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { appendChannelEvent, emit } from "../events.js";
import { parseOkfUrl, verifyConcept } from "../okf-store.js";

/** Reacting with any of these to a message that cites workspace-knowledge concepts marks those
 * concepts human-verified — the in-channel counterpart to `POST /knowledge/verify`. */
const VERIFY_EMOJI = new Set(["✅", "☑️", "✔️"]);

export const messagesApp = new OpenAPIHono<AppEnv>();

messagesApp.openapi(
  createRoute({
    method: "get",
    path: "/{channelId}/messages",
    request: {
      params: z.object({ channelId }),
      query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().positive().max(200).optional() }),
    },
    responses: { 200: { content: { "application/json": { schema: contract.listMessagesOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { channelId: id } = c.req.valid("param");
    const { cursor, limit } = c.req.valid("query");
    // Message sks are ULIDs, so DynamoDB key order is chronological. ScanIndexForward:false makes
    // the first (cursorless) page the NEWEST `limit` messages — the ones a channel is opened at —
    // and `nextCursor` then walks backwards into older history one page at a time. Each page's
    // items come back newest-first; reverse so callers can render a page top-to-bottom as
    // oldest -> newest.
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `CHANNEL#${id}`, ":prefix": "MSG#" },
        Limit: limit ?? 50,
        ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64").toString()) : undefined,
        ScanIndexForward: false,
      }),
    );
    return c.json({
      messages: (res.Items ?? []).map((i) => i.message).reverse(),
      nextCursor: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64") : undefined,
    });
  },
);

messagesApp.openapi(
  createRoute({
    method: "post",
    path: "/{channelId}/messages",
    request: {
      params: z.object({ channelId }),
      body: { content: { "application/json": { schema: contract.sendMessageInput.omit({ channelId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.sendMessageOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { channelId: id } = c.req.valid("param");
    const input = c.req.valid("json");
    const ctx = ctxOf(c);
    const message = {
      id: ulid(),
      workspaceId: ctx.workspaceId,
      channelId: id,
      authorId: ctx.actorId,
      isSystem: false,
      text: input.text,
      tools: [],
      citations: [],
      reactions: [],
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${id}`, sk: `MSG#${message.id}`, message } }));
    await appendChannelEvent(id, { type: "message.created", channelId: id, message });
    await emit(ctx, "message.sent", { messageId: message.id, channelId: id });

    const [channelRes, membersRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${id}` } })),
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `WORKSPACE#${ctx.workspaceId}`, ":prefix": "MEMBER#" },
        }),
      ),
    ]);
    const channel = channelRes.Item?.channel;
    const channelMemberIds: string[] = channel?.memberIds ?? [];
    const agentMembers = (membersRes.Items ?? [])
      .map((i) => i.member as Member)
      .filter((m): m is Extract<Member, { kind: "agent" }> => m.kind === "agent" && channelMemberIds.includes(m.id));

    // Only trust an @token as a real agent mention if it matches an actual agent's handle in
    // this channel — otherwise (a person's @mention, a typo, or no mention at all) the message
    // falls through to auto-triage below instead of firing a doomed invoke for a bogus handle.
    const mentionedTokens = [...input.text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);
    const mentionedAgent = agentMembers.find((a) => mentionedTokens.includes(a.handle));

    if (channel?.kind === "direct") {
      // A direct/group-DM channel's membership is fixed at creation via the @mention tagging
      // flow — being in a 1:1 or small DM with an agent IS the address, semantically equivalent
      // to tagging them. Every agent in the channel is triggered directly, no @mention or
      // "relevant" trigger required, taking priority over the assign/@mention/triage branches
      // below (which stay group-channel-only).
      await Promise.all(
        agentMembers.map((agent) =>
          workflow.start(Resource.AgentRuntime, {
            name: `${message.id}-${agent.id}`,
            payload: {
              workspaceId: ctx.workspaceId,
              channelId: id,
              messageId: message.id,
              mode: "direct",
              agentId: agent.id,
              triggeredBy: "direct-message",
              actorId: ctx.actorId,
              channelName: channel?.name,
              channelTopic: channel?.topic,
              prompt: input.text,
            },
          }),
        ),
      );
    } else if (input.assigneeId || mentionedAgent) {
      // Someone was specifically tagged — the actual multi-step reasoning loop lives in
      // services/agent-runtime, started async so this request returns immediately. Named
      // (message, agent) so a retried start resumes the same execution instead of double-running
      // the agent.
      const directAgentId = (input.assigneeId ?? mentionedAgent?.id)!;
      await workflow.start(Resource.AgentRuntime, {
        name: `${message.id}-${directAgentId}`,
        payload: {
          workspaceId: ctx.workspaceId,
          channelId: id,
          messageId: message.id,
          mode: "direct",
          agentId: directAgentId,
          triggeredBy: input.assigneeId ? "assign" : `@${mentionedAgent?.handle}`,
          actorId: ctx.actorId,
          channelName: channel?.name,
          channelTopic: channel?.topic,
          prompt: input.text,
        },
      });
    } else {
      // No explicit tag — every agent in the channel with the "relevant" trigger enabled
      // independently judges whether it's relevant to their own role (see
      // services/agent-runtime/src/handler.ts's triage step) and reacts if so, rather than one
      // dispatcher picking a single "best" agent.
      const triageAgents = agentMembers.filter(
        (a) => a.id !== ctx.actorId && a.config.triggers.some((t) => t.kind === "relevant" && t.enabled),
      );
      await Promise.all(
        triageAgents.map((agent) =>
          workflow.start(Resource.AgentRuntime, {
            name: `${message.id}-${agent.id}`,
            payload: {
              workspaceId: ctx.workspaceId,
              channelId: id,
              messageId: message.id,
              mode: "triage",
              agentId: agent.id,
              triggeredBy: "relevant",
              actorId: ctx.actorId,
              channelName: channel?.name,
              channelTopic: channel?.topic,
              prompt: input.text,
            },
          }),
        ),
      );
    }

    return c.json(message);
  },
);

async function getOwnMessage(channelId: string, id: string, actorId: string): Promise<Message> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `CHANNEL#${channelId}`, sk: `MSG#${id}` } }));
  if (!res.Item) throw new HTTPException(404, { message: `message ${id} not found` });
  const message: Message = res.Item.message;
  if (message.authorId !== actorId) throw new HTTPException(403, { message: "you can only edit or delete your own messages" });
  return message;
}

messagesApp.openapi(
  createRoute({
    method: "post",
    path: "/{channelId}/messages/{messageId}/reactions",
    request: {
      params: z.object({ channelId, messageId }),
      body: { content: { "application/json": { schema: contract.toggleReactionInput.omit({ channelId: true, messageId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.toggleReactionOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: chId, messageId: msgId } = c.req.valid("param");
    const { emoji } = c.req.valid("json");

    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `CHANNEL#${chId}`, sk: `MSG#${msgId}` } }));
    if (!res.Item) throw new HTTPException(404, { message: `message ${msgId} not found` });
    const existing: Message = res.Item.message;

    const already = existing.reactions.some((r) => r.memberId === ctx.actorId && r.emoji === emoji);
    const message: Message = {
      ...existing,
      reactions: already
        ? existing.reactions.filter((r) => !(r.memberId === ctx.actorId && r.emoji === emoji))
        : [...existing.reactions, { emoji, memberId: ctx.actorId }],
    };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${chId}`, sk: `MSG#${msgId}`, message } }));
    await appendChannelEvent(chId, { type: "message.updated", channelId: chId, message });
    await emit(ctx, "message.reacted", { messageId: msgId, emoji, removed: already });

    if (!already && VERIFY_EMOJI.has(emoji)) {
      // Best-effort — a verification hiccup must never fail the reaction itself. Citations only
      // carry `okf://` URLs when an agent cited a knowledge concept it retrieved.
      await Promise.all(
        (existing.citations ?? []).map(async (cite) => {
          const ref = cite.url ? parseOkfUrl(cite.url) : null;
          if (!ref || ref.workspaceId !== ctx.workspaceId) return;
          try {
            await verifyConcept(ctx.workspaceId, ref.path, humanActor(ctx.actorId));
            await emit(ctx, "knowledge.verified", { path: ref.path, via: "reaction", messageId: msgId });
          } catch (err) {
            console.error("api: knowledge verify via reaction failed:", err instanceof Error ? err.message : err);
          }
        }),
      );
    }
    return c.json(message);
  },
);

messagesApp.openapi(
  createRoute({
    method: "patch",
    path: "/{channelId}/messages/{messageId}",
    request: {
      params: z.object({ channelId, messageId }),
      body: { content: { "application/json": { schema: contract.editMessageInput.omit({ channelId: true, messageId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.editMessageOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: chId, messageId: msgId } = c.req.valid("param");
    const { text } = c.req.valid("json");

    const existing = await getOwnMessage(chId, msgId, ctx.actorId);
    const message: Message = { ...existing, text, editedAt: new Date().toISOString() };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${chId}`, sk: `MSG#${msgId}`, message } }));
    await appendChannelEvent(chId, { type: "message.updated", channelId: chId, message });
    await emit(ctx, "message.edited", { messageId: msgId });
    return c.json(message);
  },
);

messagesApp.openapi(
  createRoute({
    method: "delete",
    path: "/{channelId}/messages/{messageId}",
    request: { params: z.object({ channelId, messageId }) },
    responses: { 200: { content: { "application/json": { schema: contract.deleteMessageOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { channelId: chId, messageId: msgId } = c.req.valid("param");

    const existing = await getOwnMessage(chId, msgId, ctx.actorId);
    const message: Message = { ...existing, text: undefined, tools: [], citations: [], artifact: undefined, deletedAt: new Date().toISOString() };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${chId}`, sk: `MSG#${msgId}`, message } }));
    await appendChannelEvent(chId, { type: "message.updated", channelId: chId, message });
    await emit(ctx, "message.deleted", { messageId: msgId });
    return c.json(message);
  },
);
