import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Open Knowledge Format (OKF) v0.2 — https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 *
 * OKF is a *file format* for agent-maintained knowledge: a bundle is a directory tree of markdown
 * files, each with a YAML frontmatter block, that answers provenance ("what made this?"), trust
 * ("was it reviewed?"), freshness ("is it still current?") and lifecycle ("draft/stable/deprecated")
 * for every concept. This module is the pure format layer — parse/serialise a concept, derive its
 * trust tier and staleness, maintain a `log.md` — with no I/O. Storage lives elsewhere:
 *   - services/agent-runtime/src/memory.ts  — the agent-facing MemoryStore over an OKF bundle in S3
 *   - services/api/src/okf-store.ts          — human CRUD + verification over the same bundle
 *
 * We keep only the subset the product uses: concept documents, `log.md`, and the actor/trust/
 * lifecycle vocabulary. `Attested Computation` concepts (runtime/executor/attester) are out of
 * scope for now — nothing here defines verifiable computations yet — but an unknown `type` and
 * unknown frontmatter keys round-trip untouched, exactly as the spec's conformance rules require.
 */

export const OKF_VERSION = "0.2";

/**
 * Identity of whatever performed an action, per the spec's actor convention:
 *   - `"<producer>/<version>"` for agents, e.g. `"beacon/anthropic.claude-3-5-sonnet-20241022-v2:0"`
 *   - `"human:<id>"` for people (here, a workspace member id)
 *   - `"process:<id>"` for automated processes
 */
export type OkfActor = string;

/** A material a concept derives from (spec's `sources[]` provenance family). */
export interface OkfSource {
  /** Path or URL to the material — an absolute URL, a bundle-relative path, or a relative path. */
  resource: string;
  /** Stable key other concepts / footnotes can attribute to. */
  id?: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
  usage_window?: string;
}

/** How the concept's content was produced (spec's `generated` trust field). */
export interface OkfGenerated {
  by: OkfActor;
  /** ISO 8601 instant. */
  at: string;
}

/** One verification event (spec's `verified[]` trust field). */
export interface OkfVerified {
  by: OkfActor;
  /** ISO 8601 instant. */
  at: string;
}

export type OkfStatus = "draft" | "stable" | "deprecated";

export type OkfTrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

/**
 * A concept document's frontmatter. `type` is the only required field (spec conformance rule 2);
 * everything else is optional and consumers "must not reject" a bundle for missing optional fields,
 * unknown `type` values, or unknown keys — hence the index signature, which also means arbitrary
 * producer-added keys survive a parse/serialise round-trip.
 */
export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  /** Canonical URI for the underlying asset this concept is *about*. */
  resource?: string;
  tags?: string[];
  sources?: OkfSource[];
  generated?: OkfGenerated;
  verified?: OkfVerified[];
  status?: OkfStatus;
  /** ISO 8601 instant after which the content should be treated as stale. */
  stale_after?: string;
  /** Only meaningful on a bundle-root `index.md`. */
  okf_version?: string;
  [key: string]: unknown;
}

export interface OkfConcept {
  frontmatter: OkfFrontmatter;
  /** Markdown body following the frontmatter block. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Field order used when serialising, so bundle diffs stay stable and readable. Any key not listed
 * here is emitted afterwards in its existing order (this is what preserves unknown producer keys). */
const CANONICAL_ORDER = [
  "type",
  "title",
  "description",
  "resource",
  "status",
  "tags",
  "stale_after",
  "generated",
  "verified",
  "sources",
  "okf_version",
] as const;

/**
 * Parses a concept document (`<frontmatter>\n---\n<body>`). Throws when the frontmatter block is
 * absent or is not a YAML mapping — the spec requires every non-reserved `.md` file to carry
 * parseable frontmatter, so a caller reading a bundle should surface that rather than guess.
 */
export function parseConcept(md: string): OkfConcept {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) throw new Error("OKF concept has no `---` frontmatter block");
  const parsed: unknown = parseYaml(match[1] ?? "") ?? {};
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OKF concept frontmatter is not a YAML mapping");
  }
  return { frontmatter: parsed as OkfFrontmatter, body: md.slice(match[0].length).replace(/^\r?\n/, "") };
}

/** Serialises a concept back to `<frontmatter>\n---\n\n<body>\n`, with `type` first and the rest
 * in {@link CANONICAL_ORDER}. Undefined/empty optional fields are dropped. */
export function serializeConcept(concept: OkfConcept): string {
  const src = concept.frontmatter;
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_ORDER) {
    if (src[key] !== undefined && !(Array.isArray(src[key]) && (src[key] as unknown[]).length === 0)) {
      ordered[key] = src[key];
    }
  }
  for (const [key, value] of Object.entries(src)) {
    if (!(key in ordered) && value !== undefined) ordered[key] = value;
  }
  const yaml = stringifyYaml(ordered, { lineWidth: 0 }).replace(/\n$/, "");
  const body = concept.body.trim();
  return `---\n${yaml}\n---\n\n${body}\n`;
}

/** Conformance check — returns human-readable problems, empty when the concept is valid OKF v0.2. */
export function validateConcept(concept: OkfConcept): string[] {
  const errors: string[] = [];
  const type = concept.frontmatter.type;
  if (typeof type !== "string" || type.trim() === "") errors.push("frontmatter `type` is required and must be a non-empty string");
  return errors;
}

/** True when `stale_after` is set and has passed — retrieval down-ranks or skips these. */
export function isStale(frontmatter: OkfFrontmatter, now: Date = new Date()): boolean {
  if (!frontmatter.stale_after) return false;
  const t = Date.parse(frontmatter.stale_after);
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * Trust tier derived from `verified[]`, exactly as the spec defines it:
 *   - no `verified` entries        → `"unverified"`
 *   - verified only by non-humans  → `"machine-confirmed"`
 *   - verified by a `human:<id>`   → `"human-reviewed"`
 */
export function trustTier(frontmatter: OkfFrontmatter): OkfTrustTier {
  const verified = frontmatter.verified ?? [];
  if (verified.length === 0) return "unverified";
  if (verified.some((v) => typeof v.by === "string" && v.by.startsWith("human:"))) return "human-reviewed";
  return "machine-confirmed";
}

/** Appends a verification event, returning a new frontmatter object (does not mutate the input). */
export function addVerification(frontmatter: OkfFrontmatter, by: OkfActor, at: string = new Date().toISOString()): OkfFrontmatter {
  return { ...frontmatter, verified: [...(frontmatter.verified ?? []), { by, at }] };
}

export function agentActor(handle: string, model: string): OkfActor {
  return `${handle}/${model}`;
}
export function humanActor(memberId: string): OkfActor {
  return `human:${memberId}`;
}
export function processActor(id: string): OkfActor {
  return `process:${id}`;
}

/**
 * Deterministic filename for a piece of extracted content — same text always maps to the same
 * `<hash>.md`, which is how the agent MemoryStore stays idempotent under at-least-once extraction
 * retries. FNV-1a over the UTF-8 bytes: not cryptographic, but more than enough to avoid
 * collisions across one agent's fact set, and pure JS so this module stays runnable in the browser
 * bundle (`packages/ui` imports `@fizz/core`).
 */
export function conceptFilename(content: string): string {
  const text = content.trim();
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Mix both bytes of the UTF-16 code unit so non-ASCII text still contributes full entropy,
    // without needing TextEncoder (not in this package's lib set).
    hash = ((hash ^ BigInt(code & 0xff)) * prime) & mask;
    hash = ((hash ^ BigInt((code >> 8) & 0xff)) * prime) & mask;
  }
  return `${hash.toString(16).padStart(16, "0")}.md`;
}

/** Flattens a concept to the plain-text blob a MemoryStore hands back for retrieval / injection. */
export function renderForRetrieval(concept: OkfConcept): string {
  const { title, description, tags } = concept.frontmatter;
  const head = [title, description].filter((s): s is string => !!s && s.trim() !== "").join(" — ");
  const tagLine = tags && tags.length > 0 ? `\nTags: ${tags.join(", ")}` : "";
  return `${head}${tagLine}\n\n${concept.body}`.trim();
}

// ---------------------------------------------------------------------------
// log.md — an optional, newest-first, date-grouped change log for a bundle.
// ---------------------------------------------------------------------------

export type OkfLogKind = "Creation" | "Update" | "Deprecation" | "Verification";

export function emptyLog(): string {
  return "# Log\n";
}

/**
 * Inserts `* **<kind>**: <description>` into `log.md`, under a `## <YYYY-MM-DD>` heading it creates
 * if needed. Sections stay ordered newest-first; within a day the newest entry goes on top. Robust
 * to an empty or header-only file. Backdated entries (an `at` older than existing sections) are
 * slotted into the right chronological position rather than assumed away.
 */
export function appendLogEntry(logMd: string, at: string, kind: OkfLogKind, description: string): string {
  const date = at.slice(0, 10);
  const bullet = `* **${kind}**: ${description.replace(/\s+/g, " ").trim()}`;
  const base = logMd.trim() ? logMd.replace(/\s+$/, "") : "# Log";
  const lines = base.split("\n");

  const sections: { date: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (m) sections.push({ date: m[1]!, line: i });
  });

  const exact = sections.find((s) => s.date === date);
  if (exact) {
    lines.splice(exact.line + 1, 0, bullet);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const older = sections.find((s) => s.date < date);
  const headerIdx = lines.findIndex((l) => /^#\s+Log\s*$/.test(l));
  const insertAt = older ? older.line : headerIdx >= 0 ? headerIdx + 1 : lines.length;
  const block = [`## ${date}`, bullet, ""];
  if (insertAt > 0 && (lines[insertAt - 1] ?? "").trim() !== "") block.unshift("");
  lines.splice(insertAt, 0, ...block);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
