import { useMemo, useState } from "react";
import { Button } from "../primitives/Button.js";
import { Pill } from "../primitives/Pill.js";
import { Dialog } from "../primitives/Dialog.js";
import { ConfirmDialog } from "../primitives/ConfirmDialog.js";
import { Markdown } from "../primitives/Markdown.js";
import { Spinner } from "../primitives/Spinner.js";
import { MenuIcon, EditIcon, TrashIcon, CheckIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";

/**
 * Structural mirrors of `@perch/api-contract`'s `knowledge` shapes — kept local so `@perch/ui`
 * stays free of an `@perch/api-contract` dependency (same pattern as MentionsScreen).
 */
export type KnowledgeStatus = "draft" | "stable" | "deprecated";
export type KnowledgeTrust = "unverified" | "machine-confirmed" | "human-reviewed";

export type KnowledgeConceptSummary = {
  path: string;
  type: string;
  title?: string;
  description?: string;
  status: KnowledgeStatus;
  trust: KnowledgeTrust;
  generatedAt?: string;
  staleAfter?: string;
  stale: boolean;
  tags: string[];
};

export type KnowledgeDoc = {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

/** Payload for `PUT /knowledge/doc` — create or replace a curated `<domain>/<slug>.md`. */
export type KnowledgeDraft = {
  path: string;
  type: string;
  title: string;
  description?: string;
  tags?: string[];
  body: string;
  status?: KnowledgeStatus;
  staleAfter?: string;
};

const TRUST_META: Record<KnowledgeTrust, { label: string; bg: string; fg: string }> = {
  unverified: { label: "Unverified", bg: color.statusInProgressBg, fg: color.statusInProgressFg },
  "machine-confirmed": { label: "Machine-confirmed", bg: color.accentTint, fg: color.accentText },
  "human-reviewed": { label: "Human-reviewed", bg: color.statusDoneBg, fg: color.statusDoneFg },
};

const STATUS_META: Record<KnowledgeStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: color.statusOpenBg, fg: color.statusOpenFg },
  stable: { label: "Stable", bg: color.surfaceMuted, fg: color.muted },
  deprecated: { label: "Deprecated", bg: color.statusDeclinedBg, fg: color.statusDeclinedFg },
};

/** Top-level bundle directory → the label its group gets in the list. */
function groupLabel(dir: string): string {
  if (dir === "agents") return "Agent observations";
  if (dir === "") return "Bundle root";
  return dir.charAt(0).toUpperCase() + dir.slice(1);
}

/** `agents/**` docs are written by agents and can't be edited here (the API rejects a PUT to
 * `agents/`) — they can still be verified or deprecated. */
function isCurated(path: string): boolean {
  return path.includes("/") && path.split("/")[0] !== "agents";
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : iso;
}

export function KnowledgeScreen({
  workspaceName,
  concepts,
  conceptsLoading,
  selectedPath,
  doc,
  docLoading,
  canCurate,
  busy,
  error,
  onSelect,
  onVerify,
  onDeprecate,
  onSave,
  onReindex,
  isNarrow,
  onOpenSidebar,
}: {
  workspaceName: string;
  concepts: KnowledgeConceptSummary[];
  conceptsLoading?: boolean;
  selectedPath?: string;
  doc?: KnowledgeDoc;
  docLoading?: boolean;
  /** Workspace owner/admin — gates create / edit / deprecate / reindex. Verify is open to all. */
  canCurate: boolean;
  busy?: boolean;
  error?: string;
  onSelect: (path: string) => void;
  onVerify: (path: string) => void;
  onDeprecate: (path: string) => void;
  onSave: (draft: KnowledgeDraft) => void;
  onReindex: () => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const [editing, setEditing] = useState<KnowledgeDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeprecate, setConfirmDeprecate] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byDir = new Map<string, KnowledgeConceptSummary[]>();
    for (const c of [...concepts].sort((a, b) => a.path.localeCompare(b.path))) {
      const dir = c.path.includes("/") ? c.path.slice(0, c.path.indexOf("/")) : "";
      const list = byDir.get(dir) ?? [];
      list.push(c);
      byDir.set(dir, list);
    }
    // Curated domains first, `agents/` last, bundle root in between.
    return [...byDir.entries()].sort(([a], [b]) => {
      const rank = (d: string) => (d === "agents" ? 2 : d === "" ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  }, [concepts]);

  const selected = concepts.find((c) => c.path === selectedPath);

  const draftFromDoc = (): KnowledgeDraft => {
    const fm = doc?.frontmatter ?? {};
    return {
      path: doc?.path ?? "",
      type: typeof fm.type === "string" ? fm.type : "Note",
      title: typeof fm.title === "string" ? fm.title : selected?.title ?? basename(doc?.path ?? ""),
      description: typeof fm.description === "string" ? fm.description : undefined,
      tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      body: doc?.body ?? "",
      status: (typeof fm.status === "string" ? fm.status : "stable") as KnowledgeStatus,
      staleAfter: typeof fm.stale_after === "string" ? fm.stale_after : undefined,
    };
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: `1px solid ${color.borderLight}` }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: "nowrap" }}>Knowledge</span>
        {!isNarrow && (
          <>
            <span style={{ width: 1, height: 18, background: color.borderStrong }} />
            <span style={{ fontSize: 13, color: color.muted, whiteSpace: "nowrap" }}>{workspaceName}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {canCurate && (
          <>
            <Button variant="secondary" onClick={onReindex} disabled={busy}>Rebuild index</Button>
            <Button variant="primary" onClick={() => { setEditing({ path: "", type: "Note", title: "", body: "", status: "stable", tags: [] }); setCreating(true); }}>
              New doc
            </Button>
          </>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div className="ws-sb" style={{ width: isNarrow ? 200 : 264, flex: "none", borderRight: `1px solid ${color.borderLight}`, overflowY: "auto", padding: "10px 8px" }}>
          {conceptsLoading && concepts.length === 0 && (
            <div style={{ padding: 16, fontSize: 12.5, color: color.mutedLight }}>Loading…</div>
          )}
          {!conceptsLoading && concepts.length === 0 && (
            <div style={{ padding: 16, fontSize: 12.5, color: color.mutedLight, lineHeight: 1.6 }}>
              No knowledge yet. Agents add observations as they work; curated docs you add show up here too.
            </div>
          )}
          {groups.map(([dir, list]) => (
            <div key={dir || "root"} style={{ marginBottom: 10 }}>
              <div style={{ font: `600 11px ${font.sans}`, letterSpacing: "0.04em", textTransform: "uppercase", color: color.mutedLight, padding: "4px 8px" }}>
                {groupLabel(dir)}
              </div>
              {list.map((c) => {
                const active = c.path === selectedPath;
                return (
                  <button
                    key={c.path}
                    onClick={() => onSelect(c.path)}
                    className="ws-hoverable"
                    style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%", padding: "7px 8px", border: "none", borderRadius: 7, background: active ? color.accentTint : "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, flex: "none", borderRadius: 6, background: TRUST_META[c.trust].fg }} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: active ? color.ink : color.mutedDark, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.title || basename(c.path)}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 12 }}>
                      <span style={{ fontSize: 11, color: color.mutedLight, fontFamily: font.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{basename(c.path)}</span>
                      {c.stale && <Pill bg={color.statusDeclinedBg} fg={color.statusDeclinedFg} style={{ fontSize: 10, padding: "1px 5px" }}>Stale</Pill>}
                      {c.status === "deprecated" && <Pill bg={STATUS_META.deprecated.bg} fg={STATUS_META.deprecated.fg} style={{ fontSize: 10, padding: "1px 5px" }}>Deprecated</Pill>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="ws-sb" style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          {!selectedPath ? (
            <div style={{ padding: 40, maxWidth: 460, fontSize: 13, color: color.muted, lineHeight: 1.7 }}>
              Select a concept to read it, check who produced it, and mark it human-reviewed once you've
              confirmed it's correct. {canCurate ? "Use “New doc” to add a curated playbook or glossary agents can draw on." : ""}
            </div>
          ) : (
            <div style={{ maxWidth: 720, padding: "22px 28px 40px" }}>
              <div style={{ fontSize: 11.5, color: color.mutedLight, fontFamily: font.mono, marginBottom: 6 }}>{selectedPath}</div>
              <div style={{ fontSize: 19, fontWeight: 650, color: color.ink }}>{selected?.title || basename(selectedPath)}</div>
              {selected?.description && <div style={{ marginTop: 5, fontSize: 13.5, color: color.muted, lineHeight: 1.6 }}>{selected.description}</div>}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {selected && <Pill bg={color.surfaceMuted} fg={color.muted}>{selected.type}</Pill>}
                {selected && <Pill bg={TRUST_META[selected.trust].bg} fg={TRUST_META[selected.trust].fg}>{TRUST_META[selected.trust].label}</Pill>}
                {selected && <Pill bg={STATUS_META[selected.status].bg} fg={STATUS_META[selected.status].fg}>{STATUS_META[selected.status].label}</Pill>}
                {selected?.stale && <Pill bg={color.statusDeclinedBg} fg={color.statusDeclinedFg}>Stale</Pill>}
                {selected?.tags.map((t) => (
                  <Pill key={t} bg={color.surfaceMuted} fg={color.muted}>#{t}</Pill>
                ))}
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: color.mutedLight, lineHeight: 1.7 }}>
                {selected?.generatedAt && <div>Produced {fmtDate(selected.generatedAt)}</div>}
                {selected?.staleAfter && <div>Marked stale after {fmtDate(selected.staleAfter)}</div>}
                <ProvenanceLine frontmatter={doc?.frontmatter} />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, paddingBottom: 16, borderBottom: `1px solid ${color.borderLight}` }}>
                <Button
                  variant="secondary"
                  onClick={() => onVerify(selectedPath)}
                  disabled={busy || selected?.status === "deprecated"}
                >
                  <CheckIcon size={11} stroke={color.statusDoneFg} />
                  {selected?.trust === "human-reviewed" ? "Verify again" : "Mark human-reviewed"}
                </Button>
                {canCurate && isCurated(selectedPath) && (
                  <Button variant="secondary" onClick={() => setEditing(draftFromDoc())} disabled={busy || docLoading}>
                    <EditIcon size={12} />
                    Edit
                  </Button>
                )}
                {canCurate && selected?.status !== "deprecated" && (
                  <Button variant="secondary" onClick={() => setConfirmDeprecate(selectedPath)} disabled={busy}>
                    <TrashIcon size={12} stroke={color.statusDeclinedFg} />
                    Deprecate
                  </Button>
                )}
              </div>

              {error && <div style={{ marginTop: 12, fontSize: 12.5, color: color.statusDeclinedFg }}>{error}</div>}

              <div style={{ marginTop: 18 }}>
                {docLoading && !doc ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: color.muted }}>
                    <Spinner /> Loading document…
                  </div>
                ) : doc?.body?.trim() ? (
                  <Markdown>{doc.body}</Markdown>
                ) : (
                  <div style={{ fontSize: 13, color: color.mutedLight }}>This concept has no body text.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {(editing || creating) && editing && (
        <KnowledgeEditor
          draft={editing}
          creating={creating}
          busy={busy}
          error={error}
          onChange={setEditing}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSubmit={() => {
            onSave(editing);
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeprecate !== null}
        title={confirmDeprecate ? `Deprecate ${basename(confirmDeprecate)}?` : "Deprecate concept?"}
        message="It's marked deprecated and drops out of what agents retrieve. The file itself is kept, so you can restore it by editing its status back."
        confirmLabel="Deprecate"
        onConfirm={() => {
          if (confirmDeprecate) onDeprecate(confirmDeprecate);
          setConfirmDeprecate(null);
        }}
        onClose={() => setConfirmDeprecate(null)}
      />
    </div>
  );
}

function ProvenanceLine({ frontmatter }: { frontmatter?: Record<string, unknown> }) {
  const gen = frontmatter?.generated as { by?: string; at?: string } | undefined;
  const verified = Array.isArray(frontmatter?.verified) ? (frontmatter!.verified as { by?: string; at?: string }[]) : [];
  if (!gen?.by && verified.length === 0) return null;
  return (
    <>
      {gen?.by && <div>By <span style={{ fontFamily: font.mono }}>{gen.by}</span></div>}
      {verified.length > 0 && (
        <div>
          Verified by {verified.map((v) => v.by).filter(Boolean).map((b) => b!.replace(/^human:/, "")).join(", ")}
        </div>
      )}
    </>
  );
}

function KnowledgeEditor({
  draft,
  creating,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: KnowledgeDraft;
  creating: boolean;
  busy?: boolean;
  error?: string;
  onChange: (d: KnowledgeDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const pathOk = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]*\.md$/.test(draft.path) && draft.path.split("/")[0] !== "agents";
  const canSubmit = !!draft.title.trim() && !!draft.type.trim() && pathOk;

  return (
    <Dialog open onClose={onCancel} title={creating ? "New knowledge doc" : `Edit ${basename(draft.path)}`} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}
      >
        <Labelled label="Path">
          <input
            value={draft.path}
            onChange={(e) => onChange({ ...draft, path: e.target.value })}
            readOnly={!creating}
            placeholder="playbooks/oncall.md"
            style={{ ...field, fontFamily: font.mono, color: creating ? color.ink : color.mutedDark }}
          />
          {creating && !pathOk && draft.path.length > 0 && (
            <span style={{ fontSize: 11.5, color: color.statusDeclinedFg }}>Use <code>{"<domain>/<slug>.md"}</code> — <code>agents/</code> is reserved for agents.</span>
          )}
        </Labelled>
        <div style={{ display: "flex", gap: 10 }}>
          <Labelled label="Title" style={{ flex: 1 }}>
            <input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} autoFocus style={field} />
          </Labelled>
          <Labelled label="Type" style={{ width: 150 }}>
            <input value={draft.type} onChange={(e) => onChange({ ...draft, type: e.target.value })} placeholder="Note" style={field} />
          </Labelled>
        </div>
        <Labelled label="Description">
          <input value={draft.description ?? ""} onChange={(e) => onChange({ ...draft, description: e.target.value || undefined })} style={field} />
        </Labelled>
        <div style={{ display: "flex", gap: 10 }}>
          <Labelled label="Tags (comma-separated)" style={{ flex: 1 }}>
            <input
              value={(draft.tags ?? []).join(", ")}
              onChange={(e) => onChange({ ...draft, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              style={field}
            />
          </Labelled>
          <Labelled label="Status" style={{ width: 150 }}>
            <select value={draft.status ?? "stable"} onChange={(e) => onChange({ ...draft, status: e.target.value as KnowledgeStatus })} style={field}>
              <option value="draft">Draft</option>
              <option value="stable">Stable</option>
              <option value="deprecated">Deprecated</option>
            </select>
          </Labelled>
        </div>
        <Labelled label="Body (Markdown)">
          <textarea
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            rows={12}
            style={{ ...field, height: "auto", resize: "vertical", fontFamily: font.mono, lineHeight: 1.6 }}
          />
        </Labelled>
        {error && <div style={{ fontSize: 12.5, color: color.statusDeclinedFg }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !canSubmit}>{busy ? "Saving…" : creating ? "Create doc" : "Save changes"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Labelled({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, ...style }}>
      <span style={{ font: `500 12px ${font.sans}`, color: color.mutedDark }}>{label}</span>
      {children}
    </label>
  );
}

const field: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  borderRadius: radius.md,
  border: `1px solid ${color.borderStrong}`,
  font: `400 13.5px ${font.sans}`,
  color: color.ink,
  outline: "none",
  background: color.surface,
  boxSizing: "border-box",
  width: "100%",
};

const iconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  borderRadius: radius.md,
  cursor: "pointer",
};
