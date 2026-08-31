import { z } from "zod";
import { connectorId, memberId } from "@perch/core";

/**
 * Contracts for the Connectors page (Settings → Connectors) and the per-agent connect flow that
 * sits on top of it for connectors that have one (Google Workspace today). The workspace-admin
 * config surface is connector-generic — a `values` map validated server-side against
 * `CONNECTORS[id].configFields` (see @perch/core) — while the per-agent authorize/connect schemas
 * below stay shaped for Google's OAuth flow.
 */

const connectorConfigField = z.object({
  key: z.string(),
  label: z.string(),
  placeholder: z.string().optional(),
  secret: z.boolean(),
});

/** One row on the Connectors page: static descriptor fields + this workspace's current state. */
export const connectorSummary = z.object({
  id: connectorId,
  name: z.string(),
  description: z.string(),
  docsUrl: z.string().optional(),
  configFields: z.array(connectorConfigField),
  hasPerAgentConnect: z.boolean(),
  configured: z.boolean(),
  /** non-secret stored field values (e.g. clientId) so the UI can show what's set; omitted when not configured */
  publicValues: z.record(z.string(), z.string()).optional(),
});
export const listConnectorsOutput = z.array(connectorSummary);

/** Generic config write — keys/values are validated against the connector's declared fields. */
export const putConnectorConfigInput = z.object({ values: z.record(z.string(), z.string().min(1)) });
export const putConnectorConfigOutput = z.object({ configured: z.literal(true) });

export const getConnectorStatusOutput = z.object({
  configured: z.boolean(),
  publicValues: z.record(z.string(), z.string()).optional(),
});

export const deleteConnectorConfigOutput = z.object({ configured: z.literal(false) });

// ── Per-agent connect flow (Google Workspace) ────────────────────────────────────────────────────

/** Backs the desktop app's `begin_google_connect`, per agent: the OAuth client id plus the minimal
 * scope set this specific agent needs (derived from its tool grants — see `googleScopesForGrants`
 * in @perch/core), so an agent that only has `calendar` never prompts the human for Gmail access. */
export const getAuthorizeOutput = z.object({
  clientId: z.string(),
  scopes: z.array(z.string()),
});

/** POSTed once the `perch://google-workspace-callback` redirect lands, with the stashed PKCE verifier. */
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
