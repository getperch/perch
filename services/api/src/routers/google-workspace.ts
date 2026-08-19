import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { googleWorkspace as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { deleteGoogleOAuthClient, getGoogleOAuthClientStatus, storeGoogleOAuthClient } from "../google-oauth.js";

export const googleWorkspaceApp = new OpenAPIHono<AppEnv>();

// The desktop app builds Google's authorize URL from `GET /members/agents/{memberId}/google-
// workspace/authorize` (routers/members.ts) — it returns the OAuth client id *and* that agent's
// least-privilege scope set together, so there's no standalone client-id endpoint here any more.

/** Backs the Settings screen's Google Workspace card — lets a workspace member enter/update the
 * one OAuth client this workspace's agents share (never returns the secret once stored). */
googleWorkspaceApp.openapi(
  createRoute({
    method: "put",
    path: "/client",
    request: { body: { content: { "application/json": { schema: contract.putClientInput } } } },
    responses: { 200: { content: { "application/json": { schema: contract.putClientOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { clientId, clientSecret } = c.req.valid("json");
    await storeGoogleOAuthClient(ctx.workspaceId, { clientId, clientSecret });
    return c.json({ configured: true as const, clientId });
  },
);

/** Lets the Settings screen show current configuration state without ever seeing the secret. */
googleWorkspaceApp.openapi(
  createRoute({
    method: "get",
    path: "/status",
    responses: { 200: { content: { "application/json": { schema: contract.getClientStatusOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const status = await getGoogleOAuthClientStatus(ctx.workspaceId);
    return c.json(status);
  },
);

googleWorkspaceApp.openapi(
  createRoute({
    method: "delete",
    path: "/client",
    responses: { 200: { content: { "application/json": { schema: contract.deleteClientOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    await deleteGoogleOAuthClient(ctx.workspaceId);
    return c.json({ configured: false as const });
  },
);
