import { DeleteParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { HTTPException } from "hono/http-exception";
import { readConnectorConfig } from "./connector-config.js";

/**
 * The Google-Workspace-specific half of the connectors feature: the OAuth wire calls, and the
 * per-agent refresh-token SSM path. The workspace-level client credentials (clientId/clientSecret)
 * are stored via the connector-generic `connector-config.ts` under connectorId `"google-workspace"`
 * — this module just reads them back for the token exchanges.
 *
 * Per-agent token path (must match the tool Lambdas that re-derive it — no shared package with
 * services/tools/*, see services/tools/gmail/src/google-token.ts; keep in sync):
 *
 *   /perch/${STAGE}/${workspaceId}/agents/${memberId}/connectors/google-workspace/token
 *
 * A distinct refresh token per (workspaceId, memberId) pair — each grant is a different human's own
 * Google account connected to that specific agent.
 */
const STAGE = process.env.STAGE ?? "dev";

const ssm = new SSMClient({});

export function googleAgentTokenSsmPath(workspaceId: string, memberId: string): string {
  return `/perch/${STAGE}/${workspaceId}/agents/${memberId}/connectors/google-workspace/token`;
}

type GoogleOAuthClient = { clientId: string; clientSecret: string };

/** Throws a clear, visible 400 rather than silently proceeding with an empty client id/secret. */
export async function requireGoogleOAuthClient(workspaceId: string): Promise<GoogleOAuthClient> {
  const values = await readConnectorConfig(workspaceId, "google-workspace");
  const clientId = values?.clientId;
  const clientSecret = values?.clientSecret;
  if (!clientId || !clientSecret) {
    throw new HTTPException(400, {
      message: "Google Workspace isn't configured for this workspace yet — a workspace admin needs to add the Google OAuth client in Settings → Connectors.",
    });
  }
  return { clientId, clientSecret };
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

/** One-time authorization_code -> token exchange, done server-side (has the client_secret —
 * Google's token endpoint requires it for this OAuth client type even with PKCE in practice). */
export async function exchangeGoogleAuthCode(workspaceId: string, input: { code: string; redirectUri: string; codeVerifier: string }): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = await requireGoogleOAuthClient(workspaceId);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`google-workspace: token exchange failed HTTP ${res.status}: ${body.slice(0, 500)}`);
    throw new HTTPException(400, { message: "Google rejected the sign-in — try connecting again." });
  }
  const parsed = JSON.parse(body) as GoogleTokenResponse;
  if (!parsed.refresh_token) {
    // Google only issues a refresh_token on the *first* consent for a given client+account pair
    // unless `prompt=consent` and `access_type=offline` are both set on the authorize URL (see
    // apps/desktop/src-tauri/src/google_workspace.rs) — if this still happens, the user needs to
    // revoke prior access at https://myaccount.google.com/permissions and reconnect.
    throw new HTTPException(400, {
      message: "Google didn't return a refresh token — revoke Perch's access at https://myaccount.google.com/permissions and try connecting again.",
    });
  }
  return parsed;
}

/** Looks up the connected Google account's email for display — not itself a secret. */
export async function fetchGoogleUserinfo(accessToken: string): Promise<{ email: string }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`google-workspace: userinfo fetch failed HTTP ${res.status}`);
    throw new HTTPException(502, { message: "Connected to Google but couldn't read the account's email." });
  }
  const info = (await res.json()) as { email?: string };
  if (!info.email) throw new HTTPException(502, { message: "Google didn't return an email address for the connected account." });
  return { email: info.email };
}

export async function storeGoogleRefreshToken(workspaceId: string, memberId: string, refreshToken: string): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: googleAgentTokenSsmPath(workspaceId, memberId),
      Value: refreshToken,
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

export async function deleteGoogleRefreshToken(workspaceId: string, memberId: string): Promise<void> {
  await ssm.send(new DeleteParameterCommand({ Name: googleAgentTokenSsmPath(workspaceId, memberId) })).catch((err) => {
    // Idempotent: disconnecting an agent that was never connected (or already disconnected) isn't
    // an error — ParameterNotFound is the expected case, not a failure to surface.
    if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
  });
}
