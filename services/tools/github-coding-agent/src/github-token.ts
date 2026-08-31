import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

/**
 * Reads the workspace-level GitHub connector config (one fine-grained access token + a default
 * owner) that a workspace admin entered in Settings → Connectors. Path convention must match
 * services/api/src/connector-config.ts's `connectorClientSsmPath` exactly — there's no shared
 * package between services/api and services/tools/*, so it's re-derived here (same convention as
 * services/tools/gmail/src/google-token.ts). Byte-for-byte copy of
 * services/tools/github/src/github-token.ts — this Lambda is a separate deployable, not a shared
 * import, same reasoning as that file's own comment.
 *
 *   /perch/${STAGE}/${workspaceId}/connectors/github/client
 *
 * Unlike gmail/calendar there's no per-agent token — GitHub is a single workspace identity. The
 * read still goes through the `ConnectorTokenReader` assume-role with a per-invocation session
 * policy scoped to exactly this one parameter, so this Lambda holds no standing SSM grant (see
 * infra/api.ts's `ConnectorTokenReader` comment).
 */
const STAGE = process.env.STAGE ?? "dev";
const HOME_REGION = process.env.HOME_REGION;
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? "";
const TOKEN_READER_ROLE_ARN = process.env.CONNECTOR_TOKEN_READER_ROLE_ARN ?? "";

const sts = new STSClient({ region: HOME_REGION });

function clientSsmPath(workspaceId: string): string {
  return `/perch/${STAGE}/${workspaceId}/connectors/github/client`;
}

function ssmParameterArn(name: string): string {
  return `arn:aws:ssm:${HOME_REGION}:${ACCOUNT_ID}:parameter${name}`;
}

async function ssmClientForWorkspace(workspaceId: string): Promise<SSMClient> {
  if (!TOKEN_READER_ROLE_ARN || !ACCOUNT_ID) {
    throw new Error("github-coding-agent: CONNECTOR_TOKEN_READER_ROLE_ARN / ACCOUNT_ID not configured — check infra/api.ts");
  }
  const sessionPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["ssm:GetParameter"], Resource: [ssmParameterArn(clientSsmPath(workspaceId))] }],
  });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: TOKEN_READER_ROLE_ARN,
      RoleSessionName: `github-coding-agent-${workspaceId}`.slice(0, 64),
      Policy: sessionPolicy,
      DurationSeconds: 900,
    }),
  );
  const c = assumed.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
    throw new Error("github-coding-agent: AssumeRole returned no usable credentials");
  }
  return new SSMClient({
    region: HOME_REGION,
    credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
  });
}

export type GithubConnectorConfig = { token: string; defaultOwner: string };

export async function getGithubConfig(workspaceId: string): Promise<GithubConnectorConfig> {
  const ssm = await ssmClientForWorkspace(workspaceId);
  let value: string | undefined;
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: clientSsmPath(workspaceId), WithDecryption: true }));
    value = res.Parameter?.Value;
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") value = undefined;
    else throw err;
  }
  if (!value) {
    throw new Error(
      "GitHub isn't configured for this workspace — a workspace admin needs to add a GitHub access token in Settings → Connectors.",
    );
  }
  const parsed = JSON.parse(value) as Partial<GithubConnectorConfig>;
  if (!parsed.token) {
    throw new Error("The stored GitHub connector config has no access token — re-enter it in Settings → Connectors.");
  }
  return { token: parsed.token, defaultOwner: parsed.defaultOwner ?? "" };
}
