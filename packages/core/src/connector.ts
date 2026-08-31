import { z } from "zod";

/**
 * A third-party product a workspace can wire Perch up to (Google Workspace today; Slack, GitHub,
 * Notion, … later). Each one needs the same shape of workspace-admin setup — a small set of
 * credential fields entered once in Settings → Connectors and stored per-workspace as an SSM
 * SecureString — plus, for some, a per-agent connect flow on top (an agent connecting its own
 * account). This module is the single registry both `services/api` (validating config writes,
 * listing connectors) and `packages/ui` (rendering the Connectors page) read from.
 *
 * The per-connector OAuth/token *flow* itself is NOT abstracted here — Google's PKCE + token
 * endpoint + scope mapping lives in services/api/src/google-oauth.ts and the gmail/calendar tool
 * Lambdas. A second connector adds its own flow code under the same `/connectors/{id}/…` route and
 * SSM-path prefix; this registry just describes the setup surface they share.
 */
export const connectorId = z.enum(["google-workspace"]);
export type ConnectorId = z.infer<typeof connectorId>;

export type ConnectorConfigField = {
  /** key in the stored `values` map and the UI form */
  key: string;
  label: string;
  placeholder?: string;
  /** secret fields are write-only: never echoed back by `GET /connectors/{id}/status` */
  secret: boolean;
};

export type ConnectorDescriptor = {
  id: ConnectorId;
  name: string;
  /** one-line explanation shown under the connector's name on the Connectors page */
  description: string;
  /** where an admin gets the credential values (e.g. Google Cloud Console) */
  docsUrl?: string;
  configFields: ConnectorConfigField[];
  /** true when agents each connect their own account on top of the workspace config
   * (Google Workspace: yes — per-agent Gmail/Calendar). Drives whether the agent detail
   * screen shows a "Connect" button for this connector. */
  hasPerAgentConnect: boolean;
};

const GOOGLE_WORKSPACE: ConnectorDescriptor = {
  id: "google-workspace",
  name: "Google Workspace",
  description: "Let agents read and send Gmail and manage Google Calendar from their own connected account.",
  docsUrl: "https://console.cloud.google.com/apis/credentials",
  configFields: [
    { key: "clientId", label: "OAuth client ID", placeholder: "123-abc.apps.googleusercontent.com", secret: false },
    { key: "clientSecret", label: "OAuth client secret", secret: true },
  ],
  hasPerAgentConnect: true,
};

export const CONNECTORS: Record<ConnectorId, ConnectorDescriptor> = {
  "google-workspace": GOOGLE_WORKSPACE,
};

export const CONNECTOR_LIST: ConnectorDescriptor[] = Object.values(CONNECTORS);

/** Validates a config-write payload against a connector's declared fields — every declared field
 * must be present and non-empty, and no undeclared keys are accepted. Returns the cleaned map. */
export function validateConnectorConfig(id: ConnectorId, values: Record<string, string>): Record<string, string> {
  const descriptor = CONNECTORS[id];
  const cleaned: Record<string, string> = {};
  for (const field of descriptor.configFields) {
    const raw = values[field.key];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error(`${descriptor.name}: "${field.label}" is required`);
    }
    cleaned[field.key] = raw.trim();
  }
  const extra = Object.keys(values).filter((k) => !descriptor.configFields.some((f) => f.key === k));
  if (extra.length > 0) throw new Error(`${descriptor.name}: unknown config field(s) ${extra.join(", ")}`);
  return cleaned;
}

/** The non-secret subset of a stored config, safe to return from `GET /connectors/{id}/status`. */
export function publicConnectorConfig(id: ConnectorId, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CONNECTORS[id].configFields) {
    if (!field.secret && typeof values[field.key] === "string") out[field.key] = values[field.key]!;
  }
  return out;
}
