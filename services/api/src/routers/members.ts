import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { member as memberSchema, memberId, googleScopesForGrants, ALL_GOOGLE_SCOPES } from "@perch/core";
import { members as contract, googleWorkspace as googleWorkspaceContract } from "@perch/api-contract";
import type { AppEnv, Context } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { emit } from "../events.js";
import { deleteGoogleRefreshToken, exchangeGoogleAuthCode, fetchGoogleUserinfo, requireGoogleOAuthClient, storeGoogleRefreshToken } from "../google-oauth.js";

/** Backfills any zod-defaulted `AgentConfig` field (e.g. `skills`, added after some agents already
 * existed) that a raw DynamoDB item predates and therefore doesn't actually have stored — without
 * this, a member created before that field existed round-trips through the API missing it
 * entirely, which the desktop app's generated Rust structs (typify, from openapi.json) then fail
 * to decode since the field is required in the output schema. Every read path that returns or
 * otherwise uses a stored member should go through this rather than the raw DynamoDB item. */
function normalizeMember(raw: unknown) {
  return memberSchema.parse(raw);
}

/** List variant of `normalizeMember`: one un-decodable legacy row (a member stored before a
 * now-required field, or with a value that no longer validates) must not 500 the whole
 * `GET /members` — which blanks the desktop app, since it can't render without the member list.
 * Skips the offender and logs it instead. */
function normalizeMembersLenient(rawItems: unknown[]) {
  const out: ReturnType<typeof normalizeMember>[] = [];
  for (const raw of rawItems) {
    try {
      out.push(normalizeMember(raw));
    } catch (err) {
      console.error("members.list: skipping un-decodable member", { id: (raw as { id?: string })?.id, err });
    }
  }
  return out;
}

async function addMemberToChannels(ctx: Context, memberId: string, channelIds: string[]) {
  await Promise.all(
    channelIds.map(async (channelId) => {
      const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${channelId}` } }));
      if (!existing.Item || existing.Item.channel.memberIds.includes(memberId)) return;
      const channel = { ...existing.Item.channel, memberIds: [...existing.Item.channel.memberIds, memberId] };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `CHANNEL#${channelId}`, channel } }));
    }),
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : name.slice(0, 2)).toUpperCase();
}

export const membersApp = new OpenAPIHono<AppEnv>();

/** ctx.actorId is already a real Person.id (see context.ts) — this is how the client learns which one it is. */
membersApp.openapi(
  createRoute({
    method: "get",
    path: "/me",
    responses: { 200: { content: { "application/json": { schema: contract.meOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${ctx.actorId}` } }));
    if (!res.Item || res.Item.member.kind !== "person") throw new HTTPException(404, { message: "current user not found" });
    const me = normalizeMember(res.Item.member);
    if (me.kind !== "person") throw new HTTPException(404, { message: "current user not found" });
    return c.json(me);
  },
);

membersApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listMembersOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "MEMBER#" },
      }),
    );
    return c.json(normalizeMembersLenient((res.Items ?? []).map((i) => i.member)));
  },
);

/** Permanently removes a member (agent or person) and drops them from every channel's member
 * list. Guards: the workspace owner and the caller themselves can't be deleted. Messages the
 * member authored are left in place (their `authorId` just no longer resolves) so channel history
 * and the audit trail stay intact. */
membersApp.openapi(
  createRoute({
    method: "delete",
    path: "/{memberId}",
    request: { params: z.object({ memberId }) },
    responses: { 200: { content: { "application/json": { schema: contract.deleteMemberOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    if (id === ctx.actorId) throw new HTTPException(400, { message: "you can't remove yourself" });

    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${id}` } }));
    if (!res.Item) throw new HTTPException(404, { message: `member ${id} not found` });
    const target = res.Item.member;
    if (target.kind === "person" && target.role === "owner") throw new HTTPException(400, { message: "the workspace owner can't be removed" });

    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${id}` } }));

    const channels = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${ctx.workspaceId}`, ":prefix": "CHANNEL#" },
      }),
    );
    await Promise.all(
      (channels.Items ?? [])
        .filter((i) => (i.channel.memberIds as string[]).includes(id))
        .map((i) => {
          const channel = { ...i.channel, memberIds: (i.channel.memberIds as string[]).filter((m) => m !== id) };
          return ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: i.sk, channel } }));
        }),
    );

    await emit(ctx, "member.deleted", { memberId: id, kind: target.kind });
    return c.json({ deleted: true as const });
  },
);

membersApp.openapi(
  createRoute({
    method: "post",
    path: "/people",
    request: { body: { content: { "application/json": { schema: contract.createPersonInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.createPersonOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const person = {
      kind: "person" as const,
      id: ulid(),
      workspaceId: ctx.workspaceId,
      name: input.name,
      email: input.email,
      role: input.role,
      mono: initials(input.name),
      colorBg: "#c4ddfb",
      colorFg: "#00458c",
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${person.id}`, member: person } }));
    await addMemberToChannels(ctx, person.id, input.channelIds);
    await emit(ctx, "member.created", { memberId: person.id, kind: "person" });
    return c.json(person);
  },
);

/** The "Add member -> Agent" screen submits here: identity, instructions, tool grants, model, triggers, spend cap. */
membersApp.openapi(
  createRoute({
    method: "post",
    path: "/agents",
    request: { body: { content: { "application/json": { schema: contract.createAgentInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.createAgentOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const agent = {
      kind: "agent" as const,
      id: ulid(),
      workspaceId: ctx.workspaceId,
      name: input.name,
      handle: input.handle,
      roleDescription: input.roleDescription,
      mono: initials(input.name),
      colorBg: input.colorBg,
      colorFg: input.colorFg,
      config: input.config,
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${agent.id}`, member: agent } }));
    await addMemberToChannels(ctx, agent.id, input.config.postsInChannelIds);
    await emit(ctx, "member.created", { memberId: agent.id, kind: "agent", handle: agent.handle });
    return c.json(agent);
  },
);

membersApp.openapi(
  createRoute({
    method: "patch",
    path: "/agents/{memberId}",
    request: {
      params: z.object({ memberId }),
      body: { content: { "application/json": { schema: contract.updateAgentInput.shape.config } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.updateAgentOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    const config = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${id}` } }));
    if (!existing.Item || existing.Item.member.kind !== "agent") throw new HTTPException(404, { message: `agent ${id} not found` });
    // Normalize the stored record first so a field this agent predates (backfilled here via
    // normalizeMember) is written back with its default rather than staying permanently absent —
    // self-heals the DB record on every edit, not just the response.
    const current = normalizeMember(existing.Item.member);
    if (current.kind !== "agent") throw new HTTPException(404, { message: `agent ${id} not found` });
    const agent = { ...current, config: { ...current.config, ...config } };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${agent.id}`, member: agent } }));
    await emit(ctx, "member.updated", { memberId: agent.id });
    return c.json(agent);
  },
);

/** Non-secret Google Workspace connection metadata for one agent — the refresh token itself lives
 * in SSM (SecureString, see ../google-oauth.js), not here. Same single-table PK as every other
 * per-workspace record, a dedicated SK so it doesn't collide with the member's own MEMBER# item. */
function googleWorkspaceConnectionKey(workspaceId: string, id: string) {
  return { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${id}#GOOGLE_WORKSPACE` };
}

async function requireAgent(workspaceId: string, id: string) {
  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${id}` } }));
  if (!existing.Item || existing.Item.member.kind !== "agent") throw new HTTPException(404, { message: `agent ${id} not found` });
  const agent = normalizeMember(existing.Item.member);
  if (agent.kind !== "agent") throw new HTTPException(404, { message: `agent ${id} not found` });
  return agent;
}

/** Backs the AgentDetailScreen's "Connected as {email}" state — reads the lightweight metadata
 * item only, never touches SSM (no decryption round-trip needed just to show connection status). */
membersApp.openapi(
  createRoute({
    method: "get",
    path: "/agents/{memberId}/google-workspace",
    request: { params: z.object({ memberId }) },
    responses: { 200: { content: { "application/json": { schema: googleWorkspaceContract.getConnectionOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    await requireAgent(ctx.workspaceId, id);
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: googleWorkspaceConnectionKey(ctx.workspaceId, id) }));
    if (!res.Item) return c.json({ connected: false });
    return c.json({ connected: true, email: res.Item.email, scopes: res.Item.scopes, connectedAt: res.Item.connectedAt });
  },
);

/** Backs the desktop app's `begin_google_connect` — returns the workspace OAuth client id plus
 * the least-privilege scope set *this agent* needs, computed from its own tool grants
 * (`googleScopesForGrants`). The desktop app builds Google's authorize URL from this, so an agent
 * with only the `calendar` tool never asks the human for Gmail access. Replaces the old
 * `GET /google-workspace/client-id` + hardcoded `SCOPES` constant in the Rust binary. */
membersApp.openapi(
  createRoute({
    method: "get",
    path: "/agents/{memberId}/google-workspace/authorize",
    request: { params: z.object({ memberId }) },
    responses: { 200: { content: { "application/json": { schema: googleWorkspaceContract.getAuthorizeOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    const agent = await requireAgent(ctx.workspaceId, id);
    const { clientId } = await requireGoogleOAuthClient(ctx.workspaceId);
    const scopes = googleScopesForGrants(agent.config.tools);
    if (scopes.length === 0) {
      throw new HTTPException(400, {
        message: "This agent has no Gmail or Calendar tool granted — add one in the agent's Tools settings before connecting Google Workspace.",
      });
    }
    return c.json({ clientId, scopes });
  },
);

/** `complete_google_connect` (apps/desktop/src-tauri/src/google_workspace.rs) POSTs here once the
 * `perch://google-workspace-callback` redirect lands. Server-side token exchange only — the Rust
 * binary never sees the client_secret. */
membersApp.openapi(
  createRoute({
    method: "post",
    path: "/agents/{memberId}/google-workspace/connect",
    request: {
      params: z.object({ memberId }),
      body: { content: { "application/json": { schema: googleWorkspaceContract.connectInput.omit({ memberId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: googleWorkspaceContract.connectOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    const { code, redirectUri, codeVerifier } = c.req.valid("json");
    const agent = await requireAgent(ctx.workspaceId, id);

    const tokens = await exchangeGoogleAuthCode(ctx.workspaceId, { code, redirectUri, codeVerifier });
    const { email } = await fetchGoogleUserinfo(tokens.access_token);
    const scopes = tokens.scope.split(" ").filter(Boolean);
    const connectedAt = new Date().toISOString();

    // Defence in depth: the desktop app already requests only this agent's least-privilege scopes
    // (via GET .../google-workspace/authorize), but a tampered client could ask Google for more.
    // Reject any of this app's known tool scopes that the agent's own grants don't justify rather
    // than storing an over-broad token — the human would re-consent through the real flow to widen
    // it. Identity scopes Google may add on its own (openid/userinfo.*) aren't in this set and pass.
    const allowed = new Set(googleScopesForGrants(agent.config.tools));
    const excess = scopes.filter((s) => (ALL_GOOGLE_SCOPES as readonly string[]).includes(s) && !allowed.has(s));
    if (excess.length > 0) {
      throw new HTTPException(400, {
        message: `Google granted scopes this agent's tools don't need (${excess.join(", ")}) — reconnect from the agent's settings.`,
      });
    }

    await storeGoogleRefreshToken(ctx.workspaceId, id, tokens.refresh_token!);
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { ...googleWorkspaceConnectionKey(ctx.workspaceId, id), email, scopes, connectedAt },
      }),
    );
    await emit(ctx, "google_workspace.connected", { memberId: id, email });

    return c.json({ connected: true as const, email, scopes, connectedAt });
  },
);

/** Self-serve disconnect: deletes both the SSM refresh token and the metadata record. Idempotent —
 * disconnecting an agent that was never connected just no-ops rather than 404ing. */
membersApp.openapi(
  createRoute({
    method: "delete",
    path: "/agents/{memberId}/google-workspace",
    request: { params: z.object({ memberId }) },
    responses: { 200: { content: { "application/json": { schema: googleWorkspaceContract.disconnectOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId: id } = c.req.valid("param");
    await requireAgent(ctx.workspaceId, id);

    await deleteGoogleRefreshToken(ctx.workspaceId, id);
    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: googleWorkspaceConnectionKey(ctx.workspaceId, id) }));
    await emit(ctx, "google_workspace.disconnected", { memberId: id });

    return c.json({ disconnected: true as const });
  },
);
