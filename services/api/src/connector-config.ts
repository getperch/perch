import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { CONNECTORS, publicConnectorConfig, type ConnectorId } from "@perch/core";

/**
 * Per-workspace connector credentials (Settings → Connectors). One SSM SecureString per
 * (workspaceId, connectorId), holding a JSON map of that connector's `configFields` — deliberately
 * NOT an `sst.Secret`, since most workspaces never wire up a given connector and shouldn't need a
 * deploy-time step for it.
 *
 * Path convention must match the tool Lambdas that re-derive it (there's no shared package with
 * services/tools/* — see services/tools/gmail/src/google-token.ts): keep them in sync.
 *
 *   /perch/${STAGE}/${workspaceId}/connectors/${connectorId}/client
 *
 * The per-agent token path (for connectors with a per-agent connect flow) is a sibling scheme
 * built in google-oauth.ts:
 *
 *   /perch/${STAGE}/${workspaceId}/agents/${memberId}/connectors/${connectorId}/token
 */
const STAGE = process.env.STAGE ?? "dev";
const ssm = new SSMClient({});

export function connectorClientSsmPath(workspaceId: string, id: ConnectorId): string {
  return `/perch/${STAGE}/${workspaceId}/connectors/${id}/client`;
}

export async function readConnectorConfig(workspaceId: string, id: ConnectorId): Promise<Record<string, string> | undefined> {
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: connectorClientSsmPath(workspaceId, id), WithDecryption: true }));
    const value = res.Parameter?.Value;
    if (!value) return undefined;
    return JSON.parse(value) as Record<string, string>;
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") return undefined;
    throw err;
  }
}

export async function storeConnectorConfig(workspaceId: string, id: ConnectorId, values: Record<string, string>): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: connectorClientSsmPath(workspaceId, id),
      Value: JSON.stringify(values),
      Type: "SecureString",
      Overwrite: true,
    }),
  );
}

export async function deleteConnectorConfig(workspaceId: string, id: ConnectorId): Promise<void> {
  await ssm.send(new DeleteParameterCommand({ Name: connectorClientSsmPath(workspaceId, id) })).catch((err) => {
    // Idempotent: clearing a config that was never set (or already cleared) isn't an error.
    if ((err as { name?: string }).name !== "ParameterNotFound") throw err;
  });
}

/** Status shape for one connector — `configured` plus the non-secret stored values (e.g. clientId). */
export async function getConnectorStatus(workspaceId: string, id: ConnectorId): Promise<{ configured: boolean; publicValues?: Record<string, string> }> {
  const values = await readConnectorConfig(workspaceId, id);
  if (!values) return { configured: false };
  const required = CONNECTORS[id].configFields.filter((f) => f.secret).map((f) => f.key);
  const configured = required.every((k) => typeof values[k] === "string" && values[k] !== "");
  return { configured, publicValues: publicConnectorConfig(id, values) };
}
