import { useEffect, useMemo, useState } from "react";
import type { Channel, Member, SkillDoc } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { Card, SectionLabel } from "../primitives/Card.js";
import { color, font, radius, avatarPalette } from "../tokens.js";
import { avatarColorsFor, monoFor } from "../utils.js";

export type ToolOption = { name: string; desc: string; needsApproval: boolean };
export type ModelOption = { id: string; name: string; sub: string; provider: string };
export type PromptTemplate = { name: string; instructions: string };
export type PluginSummary = { name: string; version: string; description?: string };
export type ImportedAgentDraft = {
  roleDescription: string;
  instructions: string;
  toolNames: string[];
  toolApprovalOverrides: Record<string, boolean>;
  modelId: string;
  triggerEnabled: Record<string, boolean>;
  dailySpendCapUsd: number;
  skills: SkillDoc[];
};

export type NewAgentDraft = {
  name: string;
  handle: string;
  roleDescription: string;
  colorIndex: number;
  instructions: string;
  toolNames: string[];
  toolApprovalOverrides: Record<string, boolean>;
  modelId: string;
  triggerEnabled: Record<string, boolean>;
  postsInChannelIds: string[];
  dailySpendCapUsd: number;
  skills: SkillDoc[];
};

export type NewPersonDraft = {
  fullName: string;
  email: string;
  role: "owner" | "admin" | "member";
  channelIds: string[];
};

const emptyAgentDraft = (channelIds: string[], modelId = ""): NewAgentDraft => ({
  name: "",
  handle: "",
  roleDescription: "",
  colorIndex: 0,
  instructions: "",
  toolNames: [],
  toolApprovalOverrides: {},
  modelId,
  triggerEnabled: {},
  postsInChannelIds: channelIds,
  dailySpendCapUsd: 12,
  skills: [],
});

const emptyPersonDraft = (channelIds: string[]): NewPersonDraft => ({
  fullName: "",
  email: "",
  role: "member",
  channelIds,
});

export function AddMemberScreen({
  channels,
  defaultChannelIds,
  members,
  availableTools,
  availableModels,
  defaultModelId,
  templates,
  plugins,
  pluginQuery,
  onPluginQueryChange,
  trustedPluginRegistries,
  importPluginUrlBusy,
  importPluginUrlError,
  onImportPluginUrl,
  importedAgentDraft,
  onBrowsePlugin,
  busy,
  error,
  onBack,
  onCreateAgent,
  onCreatePerson,
  onAddExistingMember,
}: {
  channels: Channel[];
  defaultChannelIds: string[];
  /** Workspace members already created, so an existing agent/person can be added instead of remade. */
  members: Member[];
  availableTools: ToolOption[];
  availableModels: ModelOption[];
  /** Workspace-level default model id — pre-selects the picker for a fresh agent draft. */
  defaultModelId?: string;
  templates: PromptTemplate[];
  plugins?: PluginSummary[];
  pluginQuery?: string;
  onPluginQueryChange?: (q: string) => void;
  /** Hostnames a workspace admin has approved in Settings for "Import from URL…" — empty disables it. */
  trustedPluginRegistries?: string[];
  importPluginUrlBusy?: boolean;
  importPluginUrlError?: string;
  onImportPluginUrl?: (url: string) => void;
  importedAgentDraft?: ImportedAgentDraft | null;
  onBrowsePlugin?: (name: string, version: string) => void;
  busy?: boolean;
  error?: string;
  onBack: () => void;
  onCreateAgent: (draft: NewAgentDraft) => void;
  onCreatePerson: (draft: NewPersonDraft) => void;
  onAddExistingMember: (memberId: string) => void;
}) {
  const targetChannel = channels.find((c) => defaultChannelIds.includes(c.id));
  const existingCandidates = members.filter((m) => !targetChannel?.memberIds.includes(m.id));
  const [tab, setTab] = useState<"existing" | "person" | "agent">(existingCandidates.length > 0 ? "existing" : "agent");
  const [agentDraft, setAgentDraft] = useState<NewAgentDraft>(() => emptyAgentDraft(defaultChannelIds, defaultModelId));
  const [personDraft, setPersonDraft] = useState<NewPersonDraft>(() => emptyPersonDraft(defaultChannelIds));
  const [pluginPickerOpen, setPluginPickerOpen] = useState(false);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importUrlDraft, setImportUrlDraft] = useState("");
  const canImportFromUrl = (trustedPluginRegistries?.length ?? 0) > 0;

  useEffect(() => {
    if (!importedAgentDraft) return;
    setAgentDraft((d) => ({
      ...d,
      roleDescription: importedAgentDraft.roleDescription,
      instructions: importedAgentDraft.instructions,
      toolNames: importedAgentDraft.toolNames,
      toolApprovalOverrides: importedAgentDraft.toolApprovalOverrides,
      modelId: importedAgentDraft.modelId,
      triggerEnabled: importedAgentDraft.triggerEnabled,
      dailySpendCapUsd: importedAgentDraft.dailySpendCapUsd,
      skills: importedAgentDraft.skills,
    }));
    setPluginPickerOpen(false);
  }, [importedAgentDraft]);

  const handle = useMemo(
    () => (agentDraft.handle || agentDraft.name.trim().toLowerCase().replace(/\s+/g, "-")),
    [agentDraft.handle, agentDraft.name],
  );
  const pal = avatarPalette[agentDraft.colorIndex % avatarPalette.length]!;
  const canCreateAgent = agentDraft.name.trim().length > 0 && agentDraft.instructions.trim().length > 0 && agentDraft.modelId.length > 0;
  const canCreatePerson = personDraft.fullName.trim().length > 0 && /\S+@\S+\.\S+/.test(personDraft.email);

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Add member</h1>
        <div style={{ display: "flex", gap: 2, padding: 2, background: color.bg, borderRadius: radius.lg }}>
          <SegButton active={tab === "existing"} onClick={() => setTab("existing")}>Existing</SegButton>
          <SegButton active={tab === "person"} onClick={() => setTab("person")}>Person</SegButton>
          <SegButton active={tab === "agent"} onClick={() => setTab("agent")}>Agent</SegButton>
        </div>
        <span style={{ flex: 1 }} />
        {error && <span style={{ fontSize: 12, color: color.statusDeclinedFg, maxWidth: 320 }}>{error}</span>}
        {tab !== "existing" && (
          <Button
            variant="primary"
            disabled={busy || (tab === "agent" ? !canCreateAgent : !canCreatePerson)}
            onClick={() => (tab === "agent" ? onCreateAgent({ ...agentDraft, handle }) : onCreatePerson(personDraft))}
          >
            {busy ? "Saving…" : tab === "agent" ? "Create agent" : "Add person"}
          </Button>
        )}
      </header>

      {tab === "existing" ? (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <SectionLabel>
              {targetChannel ? `Already in the workspace, not in #${targetChannel.name}` : "Already in the workspace"}
            </SectionLabel>
            {existingCandidates.length === 0 ? (
              <div style={{ fontSize: 13, color: color.muted, padding: "8px 4px" }}>
                Everyone in the workspace is already here — use Person or Agent to add someone new.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {existingCandidates.map((m) => {
                  const pal = avatarColorsFor(m);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}>
                      <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={32} square={m.kind === "agent"} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.kind === "agent" ? m.roleDescription : m.role}
                        </div>
                      </div>
                      <Button variant="secondary" disabled={busy || !targetChannel} onClick={() => onAddExistingMember(m.id)}>
                        Add
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : tab === "person" ? (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <SectionLabel>Identity</SectionLabel>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ width: 56, height: 56, flex: "none", borderRadius: radius.pill, background: color.bg, color: color.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>
                {personDraft.fullName ? monoFor(personDraft.fullName) : "?"}
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Full name">
                  <input value={personDraft.fullName} onChange={(e) => setPersonDraft((d) => ({ ...d, fullName: e.target.value }))} placeholder="Jordan Wills" style={inputStyle} />
                </Field>
                <Field label="Work email">
                  <input value={personDraft.email} onChange={(e) => setPersonDraft((d) => ({ ...d, email: e.target.value }))} placeholder="jordan@northwind.co" style={inputStyle} />
                </Field>
              </div>
            </div>
          </Card>
          <Card>
            <SectionLabel>Access</SectionLabel>
            <div style={{ fontSize: 12, color: color.muted, marginBottom: 12, marginTop: -8 }}>
              The same access model agents use. A person can do anything their role allows, in the channels they belong to.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(["owner", "admin", "member"] as const).map((r) => (
                <RadioRow key={r} active={personDraft.role === r} onClick={() => setPersonDraft((d) => ({ ...d, role: r }))} title={r[0]!.toUpperCase() + r.slice(1)} sub={roleSub(r)} />
              ))}
            </div>
          </Card>
          <Card>
            <SectionLabel>Add to channels</SectionLabel>
            <ChannelChips channels={channels} selectedIds={personDraft.channelIds} onToggle={(id) => setPersonDraft((d) => ({ ...d, channelIds: toggle(d.channelIds, id) }))} />
          </Card>
        </div>
      ) : (
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 48px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <SectionLabel>Identity</SectionLabel>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 56, height: 56, borderRadius: radius.xl, background: pal.bg, color: pal.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>
                    {agentDraft.name ? monoFor(agentDraft.name) : "?"}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {avatarPalette.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => setAgentDraft((d) => ({ ...d, colorIndex: i }))}
                        style={{ width: 16, height: 16, borderRadius: radius.pill, background: c.bg, border: i === agentDraft.colorIndex ? `2px solid ${color.ink}` : "1px solid transparent", cursor: "pointer" }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Name">
                    <input value={agentDraft.name} onChange={(e) => setAgentDraft((d) => ({ ...d, name: e.target.value }))} style={inputStyle} />
                  </Field>
                  <Field label="Handle">
                    <input value={handle} readOnly style={{ ...inputStyle, fontFamily: font.mono, background: color.surfaceMuted, color: color.mutedDark }} />
                  </Field>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Field label="What it does" hint="Shown next to every message it posts.">
                      <input value={agentDraft.roleDescription} onChange={(e) => setAgentDraft((d) => ({ ...d, roleDescription: e.target.value }))} style={inputStyle} />
                    </Field>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <SectionLabel>Instructions</SectionLabel>
              <textarea
                value={agentDraft.instructions}
                onChange={(e) => setAgentDraft((d) => ({ ...d, instructions: e.target.value }))}
                style={{ width: "100%", height: 132, resize: "none", border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: 12, font: `400 14px/1.55 ${font.sans}`, outline: "none", background: color.surface, color: color.ink }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: color.muted }}>Start from a template:</span>
                {templates.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setAgentDraft((d) => ({ ...d, instructions: t.instructions }))}
                    className="ws-hoverable"
                    style={{ height: 24, padding: "0 12px", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.pill, font: `600 12px ${font.sans}`, color: color.mutedDark, cursor: "pointer" }}
                  >
                    {t.name}
                  </button>
                ))}
                {plugins && onBrowsePlugin && (
                  <button
                    onClick={() => {
                      setPluginPickerOpen((v) => !v);
                      setImportUrlOpen(false);
                    }}
                    className="ws-hoverable"
                    style={{ height: 24, padding: "0 12px", background: pluginPickerOpen ? color.bg : color.surface, border: `1px solid ${color.border}`, borderRadius: radius.pill, font: `600 12px ${font.sans}`, color: color.mutedDark, cursor: "pointer" }}
                  >
                    Browse plugins…
                  </button>
                )}
                {onImportPluginUrl && (
                  <button
                    onClick={() => {
                      setImportUrlOpen((v) => !v);
                      setPluginPickerOpen(false);
                    }}
                    disabled={!canImportFromUrl}
                    title={canImportFromUrl ? undefined : "Add a trusted registry hostname in workspace settings first"}
                    className="ws-hoverable"
                    style={{ height: 24, padding: "0 12px", background: importUrlOpen ? color.bg : color.surface, border: `1px solid ${color.border}`, borderRadius: radius.pill, font: `600 12px ${font.sans}`, color: canImportFromUrl ? color.mutedDark : color.mutedLight, cursor: canImportFromUrl ? "pointer" : "not-allowed" }}
                  >
                    Import from URL…
                  </button>
                )}
              </div>
              {pluginPickerOpen && plugins && onBrowsePlugin && (
                <div style={{ marginTop: 12, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
                  {onPluginQueryChange && (
                    <div style={{ padding: 8, borderBottom: `1px solid ${color.border}` }}>
                      <input
                        value={pluginQuery ?? ""}
                        onChange={(e) => onPluginQueryChange(e.target.value)}
                        placeholder="Search plugins…"
                        style={{ width: "100%", height: 28, border: `1px solid ${color.border}`, borderRadius: radius.md, padding: "0 8px", font: `400 12px ${font.sans}`, outline: "none", background: color.bg, color: color.ink }}
                      />
                    </div>
                  )}
                  {plugins.length === 0 && (
                    <div style={{ padding: 12, fontSize: 12, color: color.mutedLight }}>
                      {pluginQuery ? "No plugins match that search." : "No plugins published yet."}
                    </div>
                  )}
                  {plugins.map((p) => (
                    <button
                      key={`${p.name}@${p.version}`}
                      onClick={() => onBrowsePlugin(p.name, p.version)}
                      className="ws-hoverable"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: 10, background: color.surface, border: "none", borderTop: `1px solid ${color.border}`, cursor: "pointer" }}
                    >
                      <span style={{ display: "block", font: `600 12px ${font.mono}`, color: color.ink }}>{p.name}@{p.version}</span>
                      {p.description && <span style={{ display: "block", fontSize: 12, color: color.muted, fontFamily: font.sans }}>{p.description}</span>}
                    </button>
                  ))}
                </div>
              )}
              {importUrlOpen && onImportPluginUrl && (
                <div style={{ marginTop: 12, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, color: color.muted }}>
                    Fetches a plugin.json from a trusted host and imports it, even if it wasn't published by this workspace.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={importUrlDraft}
                      onChange={(e) => setImportUrlDraft(e.target.value)}
                      placeholder="https://example.com/plugins/my-agent/1.0.0/plugin.json"
                      style={{ flex: 1, height: 32, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 10px", font: `400 12px ${font.mono}`, outline: "none", background: color.surface, color: color.ink }}
                    />
                    <Button variant="secondary" disabled={importPluginUrlBusy || !importUrlDraft.trim()} onClick={() => onImportPluginUrl(importUrlDraft.trim())}>
                      {importPluginUrlBusy ? "Importing…" : "Import"}
                    </Button>
                  </div>
                  {importPluginUrlError && <div style={{ fontSize: 12, color: color.statusDeclinedFg }}>{importPluginUrlError}</div>}
                </div>
              )}
            </Card>

            <Card>
              <SectionLabel>Tools</SectionLabel>
              <div style={{ fontSize: 12, color: color.muted, marginBottom: 12, marginTop: -8 }}>Anything not checked here, the agent cannot do.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {availableTools.map((t) => {
                  const on = agentDraft.toolNames.includes(t.name);
                  return (
                    <button
                      key={t.name}
                      onClick={() => setAgentDraft((d) => ({ ...d, toolNames: toggle(d.toolNames, t.name) }))}
                      className="ws-hoverable"
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 10, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ width: 16, height: 16, flex: "none", marginTop: 2, borderRadius: 5, background: on ? color.ink : "transparent", border: on ? "none" : `1.5px solid ${color.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {on && <span style={{ color: color.surface, fontSize: 10 }}>✓</span>}
                      </span>
                      <span style={{ flex: 1, textAlign: "left" }}>
                        <span style={{ display: "block", font: `500 12px ${font.mono}`, color: color.ink }}>{t.name}</span>
                        <span style={{ display: "block", fontSize: 12, color: color.muted, fontFamily: font.sans }}>{t.desc}</span>
                      </span>
                      {t.needsApproval && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: color.approvalFg, background: color.approvalBg, borderRadius: 5, padding: "2px 6px" }}>
                          Approval
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(agentDraft.toolNames.includes("gmail") || agentDraft.toolNames.includes("calendar")) && (
                <div style={{ fontSize: 12, color: color.muted, marginTop: 12 }}>
                  Gmail/Calendar need a one-time Google sign-in per agent — connect it from this agent's page once it's created.
                </div>
              )}
            </Card>

            <Card>
              <SectionLabel>When it works</SectionLabel>
              <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>
                New agents respond when <strong>@mentioned</strong> in a channel they're in. Set up
                schedules (e.g. a daily digest) from <strong>Tasks → Schedules</strong> once the
                agent exists.
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 76 }}>
            <Card>
              <SectionLabel>Model</SectionLabel>
              <ModelSelect
                models={availableModels}
                value={agentDraft.modelId}
                onChange={(modelId) => setAgentDraft((d) => ({ ...d, modelId }))}
              />
            </Card>
            <Card>
              <SectionLabel>Guardrails</SectionLabel>
              <Field label="Daily spend cap">
                <input
                  value={`$${agentDraft.dailySpendCapUsd.toFixed(2)}`}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
                    if (!Number.isNaN(n)) setAgentDraft((d) => ({ ...d, dailySpendCapUsd: n }));
                  }}
                  style={{ ...inputStyle, fontFamily: font.mono }}
                />
              </Field>
              <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 4 }}>
                Anyone in a channel can approve this agent's actions. Change in workspace settings.
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: "0 14px",
        borderRadius: radius.md,
        border: "none",
        background: active ? color.surface : "transparent",
        boxShadow: active ? "0 1px 2px #00000014" : "none",
        font: `600 12px ${font.sans}`,
        color: color.ink,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: color.ink }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: color.muted }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.lg,
  padding: "0 12px",
  font: `400 14px ${font.sans}`,
  outline: "none",
  background: color.surface,
};

function RadioRow({ active, onClick, title, sub, small }: { active: boolean; onClick: () => void; title: string; sub: string; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="ws-hoverable"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: small ? "8px 10px" : 12, border: `1px solid ${active ? color.ink : color.border}`, borderRadius: radius.lg, background: color.surface, cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 16, height: 16, flex: "none", borderRadius: radius.pill, border: `1.5px solid ${active ? color.ink : color.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {active && <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: color.ink }} />}
      </span>
      <span style={{ flex: 1, textAlign: "left" }}>
        <span style={{ display: "block", fontSize: small ? 12 : 14, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: color.muted }}>{sub}</span>
      </span>
    </button>
  );
}

export function ModelSelect({ models, value, onChange }: { models: ModelOption[]; value: string; onChange: (modelId: string) => void }) {
  const byProvider = new Map<string, ModelOption[]>();
  for (const mo of models) {
    if (!byProvider.has(mo.provider)) byProvider.set(mo.provider, []);
    byProvider.get(mo.provider)!.push(mo);
  }
  const selected = models.find((mo) => mo.id === value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, height: 36 }}>
        {!selected && <option value="" disabled>Choose a model…</option>}
        {[...byProvider.entries()].map(([provider, opts]) => (
          <optgroup key={provider} label={provider}>
            {opts.map((mo) => (
              <option key={mo.id} value={mo.id}>{mo.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && <span style={{ fontSize: 12, color: color.muted, padding: "0 2px" }}>{selected.sub}</span>}
    </div>
  );
}


function ChannelChips({ channels, selectedIds, onToggle }: { channels: Channel[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {channels
        .filter((c) => selectedIds.includes(c.id))
        .map((c) => (
          <span key={c.id} style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 6px 0 8px", background: color.bg, borderRadius: radius.pill, fontSize: 12, fontWeight: 500 }}>
            #{c.name}
            <button onClick={() => onToggle(c.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
              ✕
            </button>
          </span>
        ))}
      <select
        value=""
        onChange={(e) => e.target.value && onToggle(e.target.value)}
        style={{ height: 24, padding: "0 8px", border: `1px dashed ${color.borderStrong}`, borderRadius: radius.pill, fontSize: 12, color: color.muted, background: "transparent" }}
      >
        <option value="">+ channel</option>
        {channels
          .filter((c) => !selectedIds.includes(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
      </select>
    </div>
  );
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function roleSub(role: "owner" | "admin" | "member") {
  if (role === "owner") return "Full control, including billing and deleting the workspace";
  if (role === "admin") return "Manage members, channels, and agent guardrails";
  return "Post, run agents they have access to, approve actions in their channels";
}
