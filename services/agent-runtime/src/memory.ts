import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "@strands-agents/sdk/storage";
import type { MemoryEntry, MemoryStore, SearchOptions } from "@strands-agents/sdk";
import {
  agentActor,
  appendLogEntry,
  conceptFilename,
  emptyLog,
  isStale,
  parseConcept,
  renderForRetrieval,
  serializeConcept,
  trustTier,
  type OkfConcept,
} from "@fizz/core";

/**
 * Agent memory, both halves, backed by the one `AgentMemoryBucket` (see infra/storage.ts):
 *
 *   1. `sessionStorage()` — a Strands `S3Storage` under `sessions/`, handed to a `SessionManager`
 *      in handler.ts so an agent resumes the conversation it was having in a channel across runs.
 *
 *   2. `S3KnowledgeStore` — a Strands `MemoryStore` over an Open Knowledge Format bundle under
 *      `okf/<workspaceId>/`. This is the agent's long-term, cross-channel knowledge: facts it
 *      extracts from conversations (written as `type: Observation` concept docs under
 *      `agents/<handle>/`), sitting alongside the human-curated playbooks/glossaries that
 *      services/api/src/okf-store.ts writes under `<domain>/`. `MemoryManager` (wired in handler.ts)
 *      exposes `search_memory` / `add_memory` tools over this and, with `injection: true`, folds
 *      the top matches into the model input on each user turn.
 *
 * Retrieval is deliberately a keyword overlap for now, not embeddings — a drop-in `search()`
 * upgrade later (Bedrock Titan embeddings + cosine over the bundle) without touching callers.
 */

const s3 = new S3Client({});

function bucket(): string {
  const name = process.env.AGENT_MEMORY_BUCKET_NAME;
  if (!name) throw new Error("AGENT_MEMORY_BUCKET_NAME is not set — agent memory is unavailable");
  return name;
}

/** handler.ts skips wiring memory at all when this is false, so a stage mid-migration (bucket not
 * yet deployed) still runs agents, just without memory. */
export function memoryEnabled(): boolean {
  return !!process.env.AGENT_MEMORY_BUCKET_NAME;
}

// --- 1. Conversation session snapshots -------------------------------------

export function sessionStorage(): S3Storage {
  return new S3Storage(bucket(), { prefix: "sessions/" });
}

/** One session per (workspace, channel, agent): each agent keeps its own running thread of a
 * channel. The message model has no thread concept, so the channel is the finest useful scope.
 *
 * Strands' `SessionManager` validates `sessionId` against `/^[a-z0-9_-]+$/`, so the parts (a
 * `ws_*` id and two uppercase Crockford-base32 ULIDs) are lowercased and joined with `_`, with any
 * other stray character folded to `_`. ULIDs are case-insensitive, so lowercasing keeps them
 * unique and the composite id collision-free. */
export function sessionIdFor(event: { workspaceId: string; channelId: string; agentId: string }): string {
  return [event.workspaceId, event.channelId, event.agentId]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
}

// --- 2. OKF long-term knowledge store ------------------------------------------

/** How long an agent-extracted observation is trusted for retrieval before `stale_after` trips and
 * `search()` stops returning it (the doc stays in the bundle for audit / re-verification). */
const OBSERVATION_TTL_DAYS = 90;
/** Cap on docs pulled from S3 per search — keeps a large bundle from turning one retrieval into
 * hundreds of GETs. The embeddings upgrade removes the need for this. */
const MAX_DOCS_SCANNED = 250;
const GET_CONCURRENCY = 20;

const RESERVED_BASENAMES = new Set(["index.md", "log.md"]);
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "was", "are", "has", "have", "not", "you",
  "your", "our", "its", "it's", "were", "will", "would", "should", "could", "about", "into", "than",
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export type KnowledgeStoreContext = {
  workspaceId: string;
  /** The agent's @mention handle — the directory its observations are written under. */
  agentHandle: string;
  /** The agent's model id — recorded in `generated.by` for provenance. */
  model: string;
  /** Present so an extracted fact can cite the run it came from. */
  channelId?: string;
  runId?: string;
};

export class S3KnowledgeStore implements MemoryStore {
  readonly name = "workspace-knowledge";
  readonly description =
    "The workspace's long-term knowledge — facts this and other agents have learned, plus human-curated playbooks and glossaries. Search it before answering; add durable facts worth remembering.";
  readonly writable = true;
  readonly maxSearchResults = 5;
  /** Client-side extraction (only `add` is implemented): every few turns the SDK's ModelExtractor
   * distils durable facts from the conversation and stores each via `add`. */
  readonly extraction = true;

  private readonly ctx: KnowledgeStoreContext;
  private readonly prefix: string;

  constructor(ctx: KnowledgeStoreContext) {
    this.ctx = ctx;
    this.prefix = `okf/${ctx.workspaceId}/`;
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const limit = options?.maxSearchResults ?? this.maxSearchResults;
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    try {
      const keys = await this.listConceptKeys();
      const concepts = await mapWithConcurrency(keys, GET_CONCURRENCY, (key) => this.readConcept(key));

      const now = new Date();
      const scored: { entry: MemoryEntry; score: number }[] = [];
      for (let i = 0; i < concepts.length; i++) {
        const concept = concepts[i];
        if (!concept) continue;
        const fm = concept.frontmatter;
        if (fm.status === "deprecated" || isStale(fm, now)) continue;

        const haystack = tokenize(
          [fm.title, fm.description, (fm.tags ?? []).join(" "), concept.body].filter(Boolean).join(" "),
        );
        let overlap = 0;
        for (const t of queryTokens) if (haystack.has(t)) overlap++;
        if (overlap === 0) continue;

        const tier = trustTier(fm);
        const boost = tier === "human-reviewed" ? 2 : tier === "machine-confirmed" ? 1 : 0;
        scored.push({
          score: overlap + boost,
          entry: {
            content: renderForRetrieval(concept),
            metadata: {
              path: keys[i]!.slice(this.prefix.length),
              type: typeof fm.type === "string" ? fm.type : "Unknown",
              status: fm.status ?? "stable",
              trust: tier,
              generatedAt: fm.generated?.at ?? null,
              staleAfter: fm.stale_after ?? null,
              tags: fm.tags ?? [],
            },
          },
        });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.entry);
    } catch (err) {
      // Never fail a run because retrieval hiccuped — injection is best-effort, and the model can
      // still call `search_memory` again or answer without it.
      console.error("agent-runtime: knowledge search failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  async add(content: string, metadata?: Record<string, unknown>): Promise<{ path: string }> {
    const text = content.trim();
    const title = firstLine(text, 120);
    const now = new Date();
    const staleAfter = new Date(now.getTime() + OBSERVATION_TTL_DAYS * 86_400_000);

    const source = this.ctx.channelId
      ? {
          resource: this.ctx.runId
            ? `fizz:workspace/${this.ctx.workspaceId}/channel/${this.ctx.channelId}/run/${this.ctx.runId}`
            : `fizz:workspace/${this.ctx.workspaceId}/channel/${this.ctx.channelId}`,
          title: "Agent conversation",
        }
      : undefined;

    const concept: OkfConcept = {
      frontmatter: {
        type: "Observation",
        title,
        status: "stable",
        tags: normalizeTags(metadata?.tags),
        stale_after: staleAfter.toISOString(),
        generated: { by: agentActor(this.ctx.agentHandle, this.ctx.model), at: now.toISOString() },
        ...(source ? { sources: [source] } : {}),
      },
      body: text,
    };

    const relPath = `agents/${slug(this.ctx.agentHandle)}/${conceptFilename(text)}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: this.prefix + relPath,
        Body: serializeConcept(concept),
        ContentType: "text/markdown",
      }),
    );
    await this.appendLog(now.toISOString(), "Creation", title);
    return { path: relPath };
  }

  private async listConceptKeys(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket(), Prefix: this.prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        const key = obj.Key;
        if (!key || !key.endsWith(".md")) continue;
        if (RESERVED_BASENAMES.has(key.slice(key.lastIndexOf("/") + 1))) continue;
        keys.push(key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token && keys.length < MAX_DOCS_SCANNED);
    return keys.slice(0, MAX_DOCS_SCANNED);
  }

  private async readConcept(key: string): Promise<OkfConcept | null> {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return parseConcept(await res.Body!.transformToString());
    } catch (err) {
      console.error(`agent-runtime: skipping unreadable concept ${key}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Best-effort — a lost log line is never worth failing a write over. Bounded re-read/retry
   * narrows (doesn't remove) the read-modify-write race; agent-run volume makes a collision rare. */
  private async appendLog(at: string, kind: "Creation", description: string): Promise<void> {
    const key = `${this.prefix}log.md`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let current = emptyLog();
        try {
          const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
          current = await res.Body!.transformToString();
        } catch (err) {
          if ((err as { name?: string }).name !== "NoSuchKey") throw err;
        }
        const next = appendLogEntry(current, at, kind, description);
        await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: next, ContentType: "text/markdown" }));
        return;
      } catch (err) {
        if (attempt === 2) {
          console.error("agent-runtime: could not update knowledge log.md:", err instanceof Error ? err.message : err);
        }
      }
    }
  }
}

function firstLine(text: string, max: number): string {
  const line = (text.split(/\r?\n/, 1)[0] ?? text).trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line || "Observation";
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}
