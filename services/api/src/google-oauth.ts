import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { HTTPException } from "hono/http-exception";

/**
 * Shared by `routers/members.ts` (connect/disconnect/status) and, by convention only (this repo
 * has no shared package between services/api and services/tools/*, so the same path templates are
 * re-derived — not imported — in services/tools/gmail/src/handler.ts and
 * services/tools/calendar/src/handler.ts; keep all three in sync if this ever changes), the
 * refresh-token + OAuth-client SSM paths and the Google OAuth wire calls themselves.
 *
 * Each agent's Google connection is fully independent: one workspace-level OAuth *client*
 * (clientId/clientSecret — the one thing registered by hand in Google Cloud Console, see
 * infra/README.md) entered at runtime by a workspace admin via Settings → Integrations
 * (`PUT /google-workspace/client`, stored as SSM SecureString JSON — not an `sst.Secret`, since
 * users may never touch Gmail/Calendar and shouldn't need a deploy-time step for it), but a
 * distinct refresh token per (workspaceId, memberId) pair, since each grant represents a different
 * human's own Google account connected to that specific agent.
 */
const STAGE = process.env.STAGE ?? "dev";

const ssm = new SSMClient({});

export function googleWorkspaceSsmPath(workspaceId: string, memberId: string): string {
  return `/fizz/${STAGE}/${workspaceId}/agents/${memberId}/google-workspace-refresh-token`;
}

export function googleOAuthClientSsmPath(workspaceId: string): string {
  return `/fizz/${STAGE}/${workspaceId}/google-oauth-client`;
}

type GoogleOAuthClient = { clientId: string; clientSecret: string };

async function readGoogleOAuthClient(workspaceId: string): Promise<GoogleOAuthClient | undefined> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: googleOAuthClientSsmPath(workspaceId), WithDecryption: true }));
    const value = res.Parameter?.Value;
    if (!value) return undefined;
    return JSON.parse(value) as GoogleOAuthClient;
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") return undefined;
    throw err;
  }
}

/** Throws a clear, visible 400 rather than silently proceeding with an empty client id/secret. */
export async function requireGoogleOAuthClient(workspaceId: string): Promise<GoogleOAuthClient> {
  const client = await readGoogleOAuthClient(workspaceId);
  if (!client?.clientId || !client?.clientSecret) {
    throw new HTTPException(400, {
      message: "Google Workspace isn't configured for this workspace yet — a workspace admin needs to add the Google OAuth client in Settings → Integrations.",
    });
  }
  return client;
}

export async function storeGoogleOAuthClient(workspaceId: string, client: GoogleOAuthClient): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: googleOAuthClientSsmPath(workspaceId),
      Value: JSON.stringify(client),
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

export async function getGoogleOAuthClientStatus(workspaceId: string): Promise<{ configured: boolean; clientId?: string }> {
  const client = await readGoogleOAuthClient(workspaceId);
  return client ? { configured: true, clientId: client.clientId } : { configured: false };
}

export async function deleteGoogleOAuthClient(workspaceId: string): Promise<void> {
  await ssm.send(new DeleteParameterCommand({ Name: googleOAuthClientSsmPath(workspaceId) })).catch((err) => {
    // Idempotent: clearing a config that was never set (or already cleared) isn't an error.
    if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
  });
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
      message: "Google didn't return a refresh token — revoke Fizz's access at https://myaccount.google.com/permissions and try connecting again.",
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
      Name: googleWorkspaceSsmPath(workspaceId, memberId),
      Value: refreshToken,
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

export async function deleteGoogleRefreshToken(workspaceId: string, memberId: string): Promise<void> {
  await ssm.send(new DeleteParameterCommand({ Name: googleWorkspaceSsmPath(workspaceId, memberId) })).catch((err) => {
    // Idempotent: disconnecting an agent that was never connected (or already disconnected) isn't
    // an error — ParameterNotFound is the expected case, not a failure to surface.
    if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
  });
}
