import { z } from "zod";
import { memberId } from "@fizz/core";

/** Backs the desktop app's `begin_google_connect` — it needs the OAuth client id to build the
 * Google authorize URL itself, without being rebuilt once a workspace admin configures the
 * OAuth client in Settings → Integrations. */
export const getClientIdOutput = z.object({ clientId: z.string() });

/** Backs the Settings screen's Google Workspace card — the one app-level OAuth client (from
 * Google Cloud Console) that every agent's per-agent connection in this workspace exchanges
 * tokens through. Entered/updated at runtime, not at deploy time — see infra/README.md. */
export const putClientInput = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) });
export const putClientOutput = z.object({ configured: z.literal(true), clientId: z.string() });

/** Never echoes the secret back — just enough for the Settings screen to show current state. */
export const getClientStatusOutput = z.object({ configured: z.boolean(), clientId: z.string().optional() });

export const deleteClientOutput = z.object({ configured: z.literal(false) });

/** `complete_google_connect` (apps/desktop/src-tauri/src/google_workspace.rs) POSTs here once the
 * `fizz://google-workspace-callback` redirect lands, with the PKCE verifier it stashed itself. */
export const connectInput = z.object({
  memberId,
  code: z.string().min(1),
  redirectUri: z.string().min(1),
  codeVerifier: z.string().min(1),
});
export const connectOutput = z.object({
  connected: z.literal(true),
  email: z.string(),
  scopes: z.array(z.string()),
  connectedAt: z.string().datetime(),
});

export const getConnectionInput = z.object({ memberId });
export const getConnectionOutput = z.object({
  connected: z.boolean(),
  email: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  connectedAt: z.string().datetime().optional(),
});

export const disconnectInput = z.object({ memberId });
export const disconnectOutput = z.object({ disconnected: z.literal(true) });
