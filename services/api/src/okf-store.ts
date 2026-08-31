import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addVerification,
  appendLogEntry,
  emptyLog,
  isStale,
  OKF_VERSION,
  parseConcept,
  serializeConcept,
  trustTier,
  type OkfActor,
  type OkfConcept,
  type OkfLogKind,
} from "@perch/core";

/**
 * Human-side access to a workspace's Open Knowledge Format bundle in `AgentMemoryBucket`, under
 * `okf/<workspaceId>/`. The agent side (services/agent-runtime/src/memory.ts) reads and writes the
 * same bundle; this module is the read / curate / verify path behind `routers/knowledge.ts` and the
 * ✅-reaction verification hook in `routers/messages.ts`.
 *
 * Bundle layout:
 *   okf/<ws>/index.md                  rebuilt from the tree by `rebuildIndex`
 *   okf/<ws>/log.md                    append-only change log, maintained on every write
 *   okf/<ws>/agents/<handle>/<hash>.md agent-extracted observations (read-only from here)
 *   okf/<ws>/<domain>/<slug>.md        human-curated playbooks / glossaries / notes
 *
 * A tiny S3 helper set is duplicated from the agent side rather than shared as a runtime dep, the
 * same call this repo already makes for `services/api/src/events.ts` vs the agent runtime's copy.
 */

const s3 = new S3Client({});

function bucket(): string {
  const name = process.env.AGENT_MEMORY_BUCKET_NAME;
  if (!name) throw new Error("AGENT_MEMORY_BUCKET_NAME is not set");
  return name;
}

export function bundlePrefix(workspaceId: string): string {
  return `okf/${workspaceId}/`;
}

export type ConceptSummary = {
  path: string;
  type: string;
  title?: string;
  description?: string;
  status: "draft" | "stable" | "deprecated";
  trust: ReturnType<typeof trustTier>;
  generatedAt?: string;
  staleAfter?: string;
  stale: boolean;
  tags: string[];
};

/** Rejects paths that would escape the bundle or collide with managed files. Used for every
 * caller-supplied path on a write; reads are validated only for traversal. */
export function assertCuratedPath(path: string): void {
  assertReadablePath(path);
  const top = path.split("/")[0] ?? "";
  if (top === "agents") throw new Error("`agents/` is reserved for agent-written observations");
  if (!path.includes("/")) throw new Error("a curated doc must live under a `<domain>/` directory, e.g. `playbooks/oncall.md`");
}

export function assertReadablePath(path: string): void {
  if (!path.endsWith(".md")) throw new Error("knowledge path must end in `.md`");
  if (path.startsWith("/") || path.includes("//") || path.split("/").includes("..")) throw new Error("invalid knowledge path");
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "index.md" || base === "log.md") throw new Error("`index.md` and `log.md` are managed automatically");
}

async function getText(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return await res.Body!.transformToString();
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

async function putText(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: "text/markdown" }));
}

export async function readConcept(workspaceId: string, path: string): Promise<OkfConcept | null> {
  assertReadablePath(path);
  const raw = await getText(bundlePrefix(workspaceId) + path);
  return raw === null ? null : parseConcept(raw);
}

function summarize(path: string, concept: OkfConcept): ConceptSummary {
  const fm = concept.frontmatter;
  return {
    path,
    type: typeof fm.type === "string" ? fm.type : "Unknown",
    title: typeof fm.title === "string" ? fm.title : undefined,
    description: typeof fm.description === "string" ? fm.description : undefined,
    status: fm.status ?? "stable",
    trust: trustTier(fm),
    generatedAt: fm.generated?.at,
    staleAfter: fm.stale_after,
    stale: isStale(fm),
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

export async function listConcepts(workspaceId: string): Promise<ConceptSummary[]> {
  const prefix = bundlePrefix(workspaceId);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) {
      const key = obj.Key;
      if (!key || !key.endsWith(".md")) continue;
      const base = key.slice(key.lastIndexOf("/") + 1);
      if (base === "index.md" || base === "log.md") continue;
      keys.push(key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const out = await Promise.all(
    keys.map(async (key) => {
      const raw = await getText(key);
      if (raw === null) return null;
      try {
        return summarize(key.slice(prefix.length), parseConcept(raw));
      } catch {
        return null;
      }
    }),
  );
  return out.filter((s): s is ConceptSummary => s !== null).sort((a, b) => a.path.localeCompare(b.path));
}

/** Writes a concept and records it in `log.md`. `logKind` picks the log verb. */
export async function writeConcept(
  workspaceId: string,
  path: string,
  concept: OkfConcept,
  logKind: OkfLogKind,
  logDescription: string,
): Promise<OkfConcept> {
  await putText(bundlePrefix(workspaceId) + path, serializeConcept(concept));
  await appendToLog(workspaceId, logKind, logDescription);
  return concept;
}

export async function deprecateConcept(workspaceId: string, path: string): Promise<OkfConcept> {
  assertReadablePath(path);
  const existing = await readConcept(workspaceId, path);
  if (!existing) throw new Error(`no knowledge doc at "${path}"`);
  const next: OkfConcept = { ...existing, frontmatter: { ...existing.frontmatter, status: "deprecated" } };
  return writeConcept(workspaceId, path, next, "Deprecation", `${path} — ${title(next)}`);
}

export async function verifyConcept(workspaceId: string, path: string, by: OkfActor): Promise<OkfConcept> {
  assertReadablePath(path);
  const existing = await readConcept(workspaceId, path);
  if (!existing) throw new Error(`no knowledge doc at "${path}"`);
  const next: OkfConcept = { ...existing, frontmatter: addVerification(existing.frontmatter, by) };
  return writeConcept(workspaceId, path, next, "Verification", `${path} verified by ${by}`);
}

/** Best-effort: a lost log line never fails the write it was recording. Bounded re-read/retry
 * narrows the read-modify-write race; workspace knowledge-write volume makes a collision rare. */
export async function appendToLog(workspaceId: string, kind: OkfLogKind, description: string): Promise<void> {
  const key = `${bundlePrefix(workspaceId)}log.md`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = (await getText(key)) ?? emptyLog();
      await putText(key, appendLogEntry(current, new Date().toISOString(), kind, description));
      return;
    } catch (err) {
      if (attempt === 2) console.error("api: could not update knowledge log.md:", err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Rebuilds `index.md` from the current tree — one section per top-level directory, each a bulleted
 * list of `[title](/path)` links. Progressive-disclosure entry point for a bundle browser; the
 * spec lets consumers ignore it, so this is a convenience, run on demand.
 */
export async function rebuildIndex(workspaceId: string): Promise<number> {
  const concepts = await listConcepts(workspaceId);
  const byDir = new Map<string, ConceptSummary[]>();
  for (const c of concepts) {
    const dir = c.path.includes("/") ? c.path.slice(0, c.path.indexOf("/")) : "(root)";
    const bucketList = byDir.get(dir) ?? [];
    bucketList.push(c);
    byDir.set(dir, bucketList);
  }

  const sections = [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, items]) => {
      const rows = items
        .map((i) => `- [${i.title ?? i.path}](/${i.path})${i.description ? ` — ${i.description}` : ""}`)
        .join("\n");
      return `## ${dir}\n\n${rows}`;
    });

  const body = sections.join("\n\n") || "_No concepts yet._";
  const doc: OkfConcept = {
    frontmatter: { type: "Index", title: "Workspace knowledge", okf_version: OKF_VERSION },
    body,
  };
  await putText(`${bundlePrefix(workspaceId)}index.md`, serializeConcept(doc));
  return concepts.length;
}

function title(concept: OkfConcept): string {
  const t = concept.frontmatter.title;
  return typeof t === "string" && t.trim() !== "" ? t : "(untitled)";
}

/** `okf://<workspaceId>/<path>` — how a channel message citation points at a bundle concept, so the
 * ✅-reaction hook in routers/messages.ts can verify it. Returns null for any other URL. */
export function parseOkfUrl(url: string): { workspaceId: string; path: string } | null {
  const m = /^okf:\/\/([^/]+)\/(.+\.md)$/.exec(url.trim());
  if (!m) return null;
  return { workspaceId: decodeURIComponent(m[1]!), path: m[2]! };
}
