import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

/**
 * Path conventions must exactly match `services/api/src/google-oauth.ts`'s
 * `googleAgentTokenSsmPath` / connector-config.ts's `connectorClientSsmPath` — there's no shared package between
 * services/api and services/tools/* to import them from, so these are deliberately re-derived
 * here rather than imported. Keep all three in sync.
 */
const STAGE = process.env.STAGE ?? "dev";
function ssmPath(workspaceId: string, agentId: string): string {
  return `/perch/${STAGE}/${workspaceId}/agents/${agentId}/connectors/google-workspace/token`;
}
function clientSsmPath(workspaceId: string): string {
  return `/perch/${STAGE}/${workspaceId}/connectors/google-workspace/client`;
}

// Least-privilege Google scopes this tool needs — re-derived from `@perch/core`'s
// `GOOGLE_SCOPE_*` constants (same "no shared package with services/tools, keep in sync"
// convention as the SSM paths above). list_messages/get_message need read; send needs send.
const SCOPE_GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";

// This Lambda deploys to us-east-1 (see infra/gateway.ts's file comment — Gateway can only front
// Lambdas in its own region), but the SSM parameters it reads live in the app's home region,
// written by services/api which stays there — pin explicitly, since the SDK defaults to this
// Lambda's own runtime region otherwise.
const HOME_REGION = process.env.HOME_REGION;
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? "";
const TOKEN_READER_ROLE_ARN = process.env.CONNECTOR_TOKEN_READER_ROLE_ARN ?? "";

const sts = new STSClient({ region: HOME_REGION });

class GoogleWorkspaceNotConnectedError extends Error {}

function ssmParameterArn(name: string): string {
  return `arn:aws:ssm:${HOME_REGION}:${ACCOUNT_ID}:parameter${name}`;
}

/**
 * The gmail/calendar tool Lambdas are shared singletons — this call could be for any agent. Rather
 * than hold a standing `ssm:GetParameter` grant on the wildcard `.../agents/<id>/refresh-token` family (which
 * would let one agent's tool call read another agent's refresh token), the Lambda holds no SSM
 * permission at all: it assumes `ConnectorTokenReader` here with an inline session policy scoped to
 * exactly this `(workspaceId, agentId)`'s two parameters. The resulting credentials can read
 * nothing else — see infra/api.ts's `ConnectorTokenReader` comment.
 *
 * `agentId` comes from the `__agentId` the agent-runtime injects into every tool call
 * (services/agent-runtime/src/tools.ts) — the model can't set it (reserved keys are injected after
 * model args and overwrite), and the Gateway->Lambda path is all in-account IAM. This defends fully
 * against a spoofed/confused agentId and against a bug reading the wrong parameter; it does not, on
 * its own, contain arbitrary code running inside a fully compromised tool Lambda.
 */
async function ssmClientForAgent(workspaceId: string, agentId: string): Promise<SSMClient> {
  if (!TOKEN_READER_ROLE_ARN || !ACCOUNT_ID) {
    throw new Error("gmail: CONNECTOR_TOKEN_READER_ROLE_ARN / ACCOUNT_ID not configured — check infra/api.ts");
  }
  const sessionPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["ssm:GetParameter"],
        Resource: [ssmParameterArn(ssmPath(workspaceId, agentId)), ssmParameterArn(clientSsmPath(workspaceId))],
      },
    ],
  });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: TOKEN_READER_ROLE_ARN,
      RoleSessionName: `gmail-${agentId}`.slice(0, 64),
      Policy: sessionPolicy,
      DurationSeconds: 900,
    }),
  );
  const c = assumed.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("gmail: AssumeRole returned no usable credentials");
  }
  return new SSMClient({
    region: HOME_REGION,
    credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
  });
}

async function getRefreshToken(ssm: SSMClient, workspaceId: string, agentId: string): Promise<string> {
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

async function getOAuthClient(ssm: SSMClient, workspaceId: string): Promise<{ clientId: string; clientSecret: string } | undefined> {
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
 *
 * `requiredScopes` are asserted against what Google actually returns on the refresh — an agent
 * whose Google connection predates a tool grant (or was connected for calendar only) won't have
 * the gmail scopes, and should get a clear "reconnect" error rather than an opaque 403 from the
 * Gmail API.
 */
export async function getAccessToken(workspaceId: string, agentId: string, requiredScopes: string[]): Promise<string> {
  const ssm = await ssmClientForAgent(workspaceId, agentId);

  const refreshToken = await getRefreshToken(ssm, workspaceId, agentId).catch((err) => {
    if (err instanceof GoogleWorkspaceNotConnectedError) {
      throw new Error("Gmail isn't connected for this agent — connect it from the agent's settings in Perch.");
    }
    throw err;
  });

  const client = await getOAuthClient(ssm, workspaceId);
  if (!client?.clientId || !client?.clientSecret) {
    throw new Error("Google Workspace isn't configured for this workspace — a workspace admin needs to add the Google OAuth client in Settings → Connectors.");
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
    console.error(`gmail: access token refresh failed HTTP ${res.status}: ${body.slice(0, 500)}`);
    throw new Error("Couldn't refresh this agent's Google access token — it may have been revoked. Reconnect Google Workspace from the agent's settings.");
  }

  const { access_token, scope } = (await res.json()) as { access_token: string; scope?: string };
  const granted = new Set((scope ?? "").split(" ").filter(Boolean));
  const missing = requiredScopes.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    throw new Error(
      `This agent's Google connection is missing the ${missing.join(", ")} permission — reconnect Google Workspace from the agent's settings to grant it.`,
    );
  }
  return access_token;
}

export const GMAIL_SCOPES = { readonly: SCOPE_GMAIL_READONLY, send: SCOPE_GMAIL_SEND };
