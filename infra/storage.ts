/// <reference path="../.sst/platform/config.d.ts" />

/** Single table for the whole domain — see services/api/src/db.ts for the key schema. */
export function makeTable() {
  return new sst.aws.Dynamo("Table", {
    fields: { pk: "string", sk: "string" },
    primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  });
}

/**
 * The immutable audit trail. Object Lock must be enabled at bucket *creation* (AWS won't let you
 * turn it on later), so this goes through the `transform` escape hatch since the SST Bucket
 * component doesn't expose it as a first-class prop. Compliance-mode retention (set per object in
 * services/audit-writer/src/s3-writer.ts) means not even the account root can delete or shorten
 * retention before it expires.
 */
/** Stores published agent plugins (plugin.json + skills/*.md) and the community index.json. */
export function makeAgentPluginsBucket() {
  return new sst.aws.Bucket("AgentPluginsBucket");
}

/** Stores Bedrock AgentCore browser session recordings — see services/tools/browser-agentcore. */
export function makeAgentRecordingsBucket() {
  return new sst.aws.Bucket("AgentRecordingsBucket");
}

/**
 * Agent memory. Two independent things share this one bucket, under separate prefixes:
 *   - `sessions/<workspaceId>/<channelId>/<agentId>/…` — opaque Strands `SessionManager` snapshots,
 *     so an agent resumes the conversation it was having in a channel across runs.
 *   - `okf/<workspaceId>/…` — an Open Knowledge Format bundle (markdown + YAML frontmatter): the
 *     agents' long-term, cross-channel knowledge, plus human-curated playbooks/glossaries. Read and
 *     written by services/agent-runtime/src/memory.ts (agent side) and services/api/src/okf-store.ts
 *     (human CRUD + verification).
 */
export function makeAgentMemoryBucket() {
  return new sst.aws.Bucket("AgentMemoryBucket");
}

export function makeAuditBucket() {
  return new sst.aws.Bucket("AuditBucket", {
    transform: {
      // AWS auto-enables versioning on the bucket the moment Object Lock is turned on, so no
      // separate versioning config is needed here.
      bucket: (args) => {
        args.objectLockEnabled = true;
      },
    },
  });
}
