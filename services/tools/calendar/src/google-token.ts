import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * Path conventions must exactly match `services/api/src/google-oauth.ts`'s
 * `googleWorkspaceSsmPath`/`googleOAuthClientSsmPath` — there's no shared package between
 * services/api and services/tools/* to import them from, so these are deliberately re-derived
 * here rather than imported. Keep all three in sync.
 */
const STAGE = process.env.STAGE ?? "dev";
function ssmPath(workspaceId: string, agentId: string): string {
  return `/fizz/${STAGE}/${workspaceId}/agents/${agentId}/google-workspace-refresh-token`;
}
function clientSsmPath(workspaceId: string): string {
  return `/fizz/${STAGE}/${workspaceId}/google-oauth-client`;
}

// This Lambda deploys to us-east-1 (see infra/gateway.ts's file comment — Gateway can only front
// Lambdas in its own region), but the SSM parameters it reads live in the app's home region,
// written by services/api which stays there — pin explicitly, since SSMClient defaults to this
// Lambda's own runtime region otherwise.
const ssm = new SSMClient({ region: process.env.HOME_REGION });

class GoogleWorkspaceNotConnectedError extends Error {}

async function getRefreshToken(workspaceId: string, agentId: string): Promise<string> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: ssmPath(workspaceId, agentId), WithDecryption: true }));
    const value = res.Parameter?.Value;
    if (!value) throw new GoogleWorkspaceNotConnectedError();
    return value;
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") throw new GoogleWorkspaceNotConnectedError();
    throw err;
  }
}

async function getOAuthClient(workspaceId: string): Promise<{ clientId: string; clientSecret: string } | undefined> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: clientSsmPath(workspaceId), WithDecryption: true }));
    const value = res.Parameter?.Value;
    if (!value) return undefined;
    return JSON.parse(value) as { clientId: string; clientSecret: string };
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") return undefined;
    throw err;
  }
}

/**
 * Exchanges the agent's stored refresh token for a fresh access token on every call — access
 * tokens are short-lived (~1hr) and this tool has no cache/session state between invocations
 * (each tool call is its own Firecracker microVM, see services/tools/http-fetch's handler
 * comment), so there's nothing to reuse anyway.
 */
export async function getAccessToken(workspaceId: string, agentId: string): Promise<string> {
  const refreshToken = await getRefreshToken(workspaceId, agentId).catch((err) => {
    if (err instanceof GoogleWorkspaceNotConnectedError) {
      throw new Error("Calendar isn't connected for this agent — connect Google Workspace from the agent's settings in Fizz.");
    }
    throw err;
  });

  const client = await getOAuthClient(workspaceId);
  if (!client?.clientId || !client?.clientSecret) {
    throw new Error("Google Workspace isn't configured for this workspace — a workspace admin needs to add the Google OAuth client in Settings → Integrations.");
  }
  const { clientId, clientSecret } = client;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`calendar: access token refresh failed HTTP ${res.status}: ${body.slice(0, 500)}`);
    throw new Error("Couldn't refresh this agent's Google access token — it may have been revoked. Reconnect Google Workspace from the agent's settings.");
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}
