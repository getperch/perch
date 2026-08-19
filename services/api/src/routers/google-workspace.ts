import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { googleWorkspace as contract } from "@fizz/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { deleteGoogleOAuthClient, getGoogleOAuthClientStatus, requireGoogleOAuthClient, storeGoogleOAuthClient } from "../google-oauth.js";

export const googleWorkspaceApp = new OpenAPIHono<AppEnv>();

/**
 * Lets the desktop app (`apps/desktop/src-tauri/src/google_workspace.rs`'s `begin_google_connect`)
 * build the Google authorize URL itself without the client id being baked into the Rust binary at
 * compile time — once a workspace admin configures the OAuth client via `PUT /client` below
 * (Settings → Integrations), every already-installed desktop app picks it up on its next connect
 * attempt with no rebuild.
 */
googleWorkspaceApp.openapi(
  createRoute({
    method: "get",
    path: "/client-id",
    responses: { 200: { content: { "application/json": { schema: contract.getClientIdOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { clientId } = await requireGoogleOAuthClient(ctx.workspaceId);
    return c.json({ clientId });
  },
);

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
