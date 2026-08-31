import { useState } from "react";
import type { ApprovalPolicy, ConnectorDescriptor, Member, Workspace } from "@perch/core";
import { ModelSelect, type ModelOption } from "./AddMemberScreen.js";
import { Avatar } from "../primitives/Avatar.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { SegmentedControl } from "../primitives/SegmentedControl.js";
import { ConfirmDialog } from "../primitives/ConfirmDialog.js";
import { MenuIcon, PlusLargeIcon, TrashIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { avatarColorsFor } from "../utils.js";

type Section = "general" | "people" | "connectors" | "advanced";

/** One row on the Connectors page: the static descriptor plus this workspace's current state
 * (mirrors `connectorSummary` in @perch/api-contract). */
export type ConnectorRow = ConnectorDescriptor & { configured: boolean; publicValues?: Record<string, string> };

const APPROVAL_POLICIES: { id: ApprovalPolicy; name: string; sub: string }[] = [
  { id: "channel", name: "Anyone in the channel", sub: "Fastest. Everyone present can unblock an agent." },
  { id: "requester", name: "Only whoever asked", sub: "The person who summoned the agent approves." },
  { id: "admin", name: "Admins and owners", sub: "Slowest, tightest. Good for production changes." },
];

const GENERAL_TOGGLES = [
  { key: "createChannels", label: "Anyone can create channels", note: "Members can open public channels without an admin." },
  { key: "agentsJoin", label: "Agents can join public channels", note: "Off means an agent has to be added to each channel by its owner." },
  { key: "namedApprover", label: "Deploys need a named human approver", note: "Applies to every agent regardless of its own autonomy setting." },
] as const;

export function SettingsScreen({
  initialSection = "general",
  workspace,
  members,
  availableModels,
  spendCapSaving,
  spendCapError,
  settingsSaving,
  settingsError,
  connectors,
  connectorsSaving,
  connectorsError,
  onSpendCapChange,
  onNameChange,
  onApprovalPolicyChange,
  onLimitsChange,
  onDefaultModelChange,
  onTrustedRegistriesChange,
  onConnectorConfigSave,
  onConnectorConfigClear,
  onAddPeople,
  onOpenMember,
  onConfigureAgent,
  onDeleteMember,
  currentUserId,
  onSignOut,
  isNarrow,
  onOpenSidebar,
}: {
  initialSection?: Section;
  workspace: Workspace;
  members: Member[];
  availableModels: ModelOption[];
  currentUserId: string;
  onDeleteMember: (memberId: string) => void;
  spendCapSaving?: boolean;
  spendCapError?: string;
  settingsSaving?: boolean;
  settingsError?: string;
  connectors?: ConnectorRow[];
  connectorsSaving?: boolean;
  connectorsError?: string;
  onSpendCapChange: (usd: number) => void;
  onNameChange: (name: string) => void;
  onApprovalPolicyChange: (policy: ApprovalPolicy) => void;
  onLimitsChange: (limits: { maxStepsPerRun?: number; maxConcurrentRuns?: number }) => void;
  /** Empty string clears the default back to "creator picks". */
  onDefaultModelChange: (modelId: string) => void;
  onTrustedRegistriesChange: (hosts: string[]) => void;
  onConnectorConfigSave: (connectorId: string, values: Record<string, string>) => void;
  onConnectorConfigClear: (connectorId: string) => void;
  onAddPeople: () => void;
  onOpenMember: (memberId: string) => void;
  onConfigureAgent: (memberId: string) => void;
  onSignOut: () => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  // Local-only — these three org policies aren't modelled in the backend yet.
  const [flags, setFlags] = useState<Record<string, boolean>>({ createChannels: true, agentsJoin: true, namedApprover: true });
  const [wsAutonomy, setWsAutonomy] = useState<"read" | "ask" | "auto">("ask");
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  // Connectors is a master-detail pane: pick one on the left, configure it on the right. Falls
  // back to the first connector so the pane is never empty on a wide screen.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  // No fallback — the detail pane stays empty until a connector is actually clicked.
  const activeConnector = connectors?.find((c) => c.id === selectedConnectorId);

  const nav: { key: Section; label: string }[] = [
    { key: "general", label: "General" },
    { key: "people", label: "People" },
    { key: "connectors", label: "Connectors" },
    { key: "advanced", label: "Advanced" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: `1px solid ${color.borderLight}` }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: "nowrap" }}>Workspace settings</span>
        {!isNarrow && (
          <>
            <span style={{ width: 1, height: 18, background: color.borderStrong }} />
            <span style={{ fontSize: 13, color: color.muted, whiteSpace: "nowrap" }}>{workspace.name}</span>
          </>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {!isNarrow && (
          <div style={{ width: 186, flex: "none", borderRight: `1px solid ${color.borderLight}`, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
            {nav.map((n) => (
              <button
                key={n.key}
                onClick={() => setSection(n.key)}
                className="ws-hoverable"
                style={{ display: "flex", alignItems: "center", height: 30, padding: "0 9px", borderRadius: 7, border: "none", fontSize: 13, color: section === n.key ? color.ink : color.mutedDark, background: section === n.key ? color.accentTint : "transparent", cursor: "pointer", textAlign: "left" }}
              >
                {n.label}
              </button>
            ))}
          </div>
        )}

        <div className="ws-sb" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {isNarrow && (
            <div style={{ padding: "16px 26px 0" }}>
              <SegmentedControl
                value={section}
                onChange={setSection}
                options={nav.map((n) => ({ value: n.key, label: n.label }))}
              />
            </div>
          )}

          {section === "connectors" && !isNarrow ? (
            <ConnectorsMasterDetail
              connectors={connectors}
              error={connectorsError}
              saving={connectorsSaving}
              activeConnector={activeConnector}
              onSelect={setSelectedConnectorId}
              onSave={onConnectorConfigSave}
              onClear={onConnectorConfigClear}
            />
          ) : (
          <div className="ws-sb" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px 0 30px" }}>
          <div style={{ maxWidth: 620, padding: "0 26px" }}>

            {section === "general" && (
              <>
                <H>General</H>
                <Sub>Name and the defaults every new channel and agent inherits.</Sub>

                <FieldLabel style={{ marginTop: 20 }}>Workspace name</FieldLabel>
                <WorkspaceNameField
                  key={workspace.name}
                  value={workspace.name}
                  saving={settingsSaving}
                  error={settingsError}
                  onCommit={onNameChange}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: color.mutedLight }}>Shown to everyone in the workspace.</div>

                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 22, marginBottom: 7 }}>
                  <FieldLabel style={{ marginBottom: 0 }}>Default model for new agents</FieldLabel>
                  {workspace.defaultModel && (
                    <button
                      onClick={() => onDefaultModelChange("")}
                      style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: color.muted, cursor: "pointer" }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <ModelSelect models={availableModels} value={workspace.defaultModel ?? ""} onChange={onDefaultModelChange} />
                <div style={{ marginTop: 7, fontSize: 12, color: color.mutedLight, lineHeight: 1.55 }}>
                  Pre-fills the model picker when someone adds an agent. They can still choose a different one.
                </div>

                <FieldLabel style={{ marginTop: 22 }}>Default approval policy</FieldLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {APPROVAL_POLICIES.map((p) => {
                    const active = workspace.approvalPolicy === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => onApprovalPolicyChange(p.id)}
                        className="ws-hoverable"
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: `1px solid ${active ? color.borderStrong : color.border}`, borderRadius: radius.lg, background: active ? color.surfaceMuted : color.surface, cursor: "pointer", textAlign: "left" }}
                      >
                        <span style={{ width: 16, height: 16, flex: "none", borderRadius: radius.pill, border: active ? `5px solid ${color.accent}` : `1.5px solid ${color.borderStrong}`, background: color.surface }} />
                        <span style={{ flex: 1 }}>
                          <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                          <span style={{ display: "block", fontSize: 12.5, color: color.muted }}>{p.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 24, borderTop: `1px solid ${color.borderLight}`, paddingTop: 18, display: "flex", flexDirection: "column", gap: 2 }}>
                  {GENERAL_TOGGLES.map((t) => (
                    <Toggle key={t.key} label={t.label} note={t.note} on={!!flags[t.key]} onChange={() => setFlags((f) => ({ ...f, [t.key]: !f[t.key] }))} />
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: color.mutedLight }}>These three org policies are local for now — no backend field yet.</div>
              </>
            )}

            {section === "people" && (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <H>People</H>
                    <Sub>Everyone in the workspace, human or not. Agents carry an owner and an autonomy setting; people carry a role.</Sub>
                  </div>
                  <button
                    onClick={onAddPeople}
                    style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: 8, border: "none", background: color.accent, color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
                  >
                    <PlusLargeIcon size={14} stroke="#fff" />
                    Add
                  </button>
                </div>

                <div style={{ marginTop: 18, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
                  {sortMembers(members).map((m, i) => {
                    const pal = avatarColorsFor(m);
                    const isAgent = m.kind === "agent";
                    const removable = m.id !== currentUserId && !(m.kind === "person" && m.role === "owner");
                    return (
                      <div
                        key={m.id}
                        onClick={() => (isAgent ? onConfigureAgent(m.id) : onOpenMember(m.id))}
                        className="ws-hoverable"
                        style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 14px", borderTop: i ? `1px solid ${color.borderLight}` : "none", cursor: "pointer" }}
                      >
                        <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={30} square={isAgent} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                            {isAgent && <AgentBadge />}
                          </span>
                          <span style={{ display: "block", fontSize: 12.5, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {isAgent ? m.roleDescription : m.email}
                          </span>
                        </span>
                        <span style={{ flex: "none", fontSize: 12.5, color: color.mutedDark, textTransform: "capitalize", padding: "0 4px" }}>{isAgent ? "Agent" : m.role}</span>
                        {removable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemove(m);
                            }}
                            className="ws-hoverable"
                            title={`Remove ${m.name}`}
                            style={{ flex: "none", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 7, cursor: "pointer" }}
                          >
                            <TrashIcon size={14} stroke={color.mutedLight} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {members.length === 0 && <div style={{ padding: 24, fontSize: 13, color: color.mutedLight }}>No members yet.</div>}
                </div>

                <div style={{ marginTop: 26, borderTop: `1px solid ${color.borderLight}`, paddingTop: 18, fontSize: 14, fontWeight: 600 }}>Agent defaults</div>
                <div style={{ marginTop: 4, fontSize: 13, color: color.muted, lineHeight: 1.6 }}>Ceilings for anything added to the workspace. An agent can be set lower, never higher.</div>

                <FieldLabel style={{ marginTop: 16 }}>Default autonomy</FieldLabel>
                <SegmentedControl
                  style={{ width: "fit-content" }}
                  value={wsAutonomy}
                  onChange={setWsAutonomy}
                  options={[
                    { value: "read", label: "Read-only" },
                    { value: "ask", label: "Ask first" },
                    { value: "auto", label: "Auto" },
                  ]}
                />
                <div style={{ marginTop: 8, fontSize: 12.5, color: color.muted, lineHeight: 1.6, maxWidth: 520 }}>
                  {wsAutonomy === "read"
                    ? "New agents can read and post. Every tool call is blocked until an owner grants it."
                    : wsAutonomy === "auto"
                      ? "New agents may run allowlisted tools unattended. Anything outside the allowlist still asks."
                      : "New agents ask before any tool that writes. Reads inside the allowlist run without asking."}
                </div>

                <FieldLabel style={{ marginTop: 20 }}>Workspace daily spend cap</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", height: 34, width: 200, border: `1px solid ${color.borderStrong}`, borderRadius: 8, overflow: "hidden" }}>
                  <span style={{ padding: "0 11px", height: "100%", display: "flex", alignItems: "center", fontSize: 13, color: color.mutedLight, background: color.surfaceMuted, borderRight: `1px solid ${color.borderLight}` }}>$</span>
                  <input
                    defaultValue={workspace.spendCapUsdPerDay.toFixed(0)}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
                      if (!Number.isNaN(n) && n > 0) onSpendCapChange(n);
                    }}
                    style={{ flex: 1, minWidth: 0, height: "100%", padding: "0 11px", border: 0, fontSize: 13.5, background: color.surface, outline: "none" }}
                  />
                </div>
                {spendCapSaving && <div style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>Saving…</div>}
                {spendCapError && <div style={{ fontSize: 12, color: color.statusDeclinedFg, marginTop: 6 }}>{spendCapError}</div>}
              </>
            )}

            {section === "connectors" && (
              <>
                <H>Connectors</H>
                <Sub>Wire this workspace up to third-party products. Enter each connector's credentials once; agents then connect their own accounts where that applies.</Sub>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 18 }}>
                  {connectors?.map((connector) => (
                    <div key={connector.id} style={{ display: "flex", flexDirection: "column" }}>
                      <ConnectorRow
                        connector={connector}
                        active={connector.id === selectedConnectorId}
                        onClick={() => setSelectedConnectorId(connector.id === selectedConnectorId ? null : connector.id)}
                      />
                      {connector.id === selectedConnectorId && (
                        <div style={{ padding: "10px 10px 16px" }}>
                          <ConnectorDetailPane
                            connector={connector}
                            saving={connectorsSaving}
                            error={connectorsError}
                            onSave={onConnectorConfigSave}
                            onClear={onConnectorConfigClear}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {connectors?.length === 0 && <div style={{ fontSize: 12.5, color: color.muted }}>No connectors available.</div>}
                  {!connectors && !connectorsError && <div style={{ fontSize: 12.5, color: color.muted }}>Loading connectors…</div>}
                  {!connectors && connectorsError && (
                    <div style={{ fontSize: 12.5, color: color.statusDeclinedFg }}>Couldn't load connectors: {connectorsError}</div>
                  )}
                </div>
              </>
            )}

            {section === "advanced" && (
              <>
                <H>Advanced</H>
                <Sub>Run limits, plugin trust, and the audit trail.</Sub>

                <FieldLabel style={{ marginTop: 20 }}>Run limits</FieldLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <LimitRow title="Max steps per run" sub="A run over this asks to continue" defaultValue={String(workspace.maxStepsPerRun)} onCommit={(raw) => {
                    const n = Number(raw.replace(/[^0-9]/g, ""));
                    if (Number.isInteger(n) && n > 0) onLimitsChange({ maxStepsPerRun: n });
                  }} />
                  <LimitRow title="Concurrent runs" sub="Across all agents" defaultValue={String(workspace.maxConcurrentRuns)} onCommit={(raw) => {
                    const n = Number(raw.replace(/[^0-9]/g, ""));
                    if (Number.isInteger(n) && n > 0) onLimitsChange({ maxConcurrentRuns: n });
                  }} />
                </div>
                {settingsSaving && <div style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>Saving…</div>}
                {settingsError && <div style={{ fontSize: 12, color: color.statusDeclinedFg, marginTop: 6 }}>{settingsError}</div>}

                <FieldLabel style={{ marginTop: 22 }}>Trusted plugin registries</FieldLabel>
                <div style={{ fontSize: 12.5, color: color.muted, marginBottom: 10, lineHeight: 1.55 }}>
                  Hostnames allowed for "Import from URL…" when browsing agent plugins.
                </div>
                <TrustedRegistriesEditor hosts={workspace.trustedPluginRegistries} onChange={onTrustedRegistriesChange} />

                <FieldLabel style={{ marginTop: 22 }}>Audit log</FieldLabel>
                <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>
                  Every message, run, tool call, and approval decision is written to an append-only, tamper-evident log. Nothing can be edited or deleted after the fact.
                </div>

                <FieldLabel style={{ marginTop: 22 }}>Account</FieldLabel>
                <button
                  onClick={onSignOut}
                  className="ws-hoverable"
                  style={{ height: 32, padding: "0 14px", background: color.surface, border: `1px solid ${color.borderStrong}`, borderRadius: 8, fontSize: 13, fontWeight: 500, color: color.ink, cursor: "pointer" }}
                >
                  Sign out
                </button>
              </>
            )}
          </div>
          </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={pendingRemove ? `Remove ${pendingRemove.name}?` : "Remove member?"}
        message={`${pendingRemove?.name ?? "This member"} is removed from the workspace and every channel. This can't be undone.`}
        confirmLabel="Remove"
        onConfirm={() => pendingRemove && onDeleteMember(pendingRemove.id)}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  );
}

function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "person" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function Toggle({ label, note, on, onChange }: { label: string; note: string; on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="ws-hoverable" style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "11px 10px", margin: "0 -10px", borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{label}</span>
        <span style={{ display: "block", marginTop: 3, fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>{note}</span>
      </span>
      <span style={{ position: "relative", flex: "none", width: 36, height: 21, borderRadius: 20, background: on ? color.accent : "#DEDCE4", marginTop: 2, transition: "background 120ms" }}>
        <span style={{ position: "absolute", top: 2.5, left: on ? 17.5 : 2.5, width: 16, height: 16, borderRadius: 20, background: "#fff", boxShadow: "0 1px 2px rgba(23,20,42,0.28)", transition: "left 120ms" }} />
      </span>
    </button>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 16, fontWeight: 600 }}>{children}</div>;
}
function Sub({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 5, fontSize: 13, color: color.muted, lineHeight: 1.6 }}>{children}</div>;
}
function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 12.5, fontWeight: 500, color: "#413D4E", marginBottom: 7, ...style }}>{children}</div>;
}

const inputBox: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 11px",
  border: `1px solid ${color.borderStrong}`,
  borderRadius: 8,
  fontSize: 13.5,
  background: color.surface,
  outline: "none",
  fontFamily: font.sans,
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

function TrustedRegistriesEditor({ hosts, onChange }: { hosts: string[]; onChange: (hosts: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const host = draft.trim().toLowerCase();
    if (!host || hosts.includes(host)) return;
    onChange([...hosts, host]);
    setDraft("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {hosts.length === 0 && <span style={{ fontSize: 12, color: color.mutedLight }}>None yet — plugin import is disabled until you add one.</span>}
        {hosts.map((host) => (
          <span key={host} style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 6px 0 8px", background: color.surfaceMuted, border: `1px solid ${color.border}`, borderRadius: radius.pill, fontSize: 12, fontFamily: font.mono, fontWeight: 500 }}>
            {host}
            <button onClick={() => onChange(hosts.filter((h) => h !== host))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="raw.githubusercontent.com"
          style={{ flex: 1, height: 32, border: `1px solid ${color.borderStrong}`, borderRadius: 8, padding: "0 10px", font: `400 13px ${font.mono}`, outline: "none", background: color.surface, color: color.ink }}
        />
        <button onClick={add} className="ws-hoverable" style={{ height: 32, padding: "0 14px", background: color.surface, border: `1px solid ${color.borderStrong}`, borderRadius: 8, font: `500 13px ${font.sans}`, color: color.ink, cursor: "pointer" }}>
          Add
        </button>
      </div>
    </div>
  );
}

/** The config control for one connector — summary (when configured) or credential form. No title
 * or card chrome: the surrounding pane (`ConnectorDetailPane`) owns the connector's name and
 * description. Remount it (`key={connector.id}`) when switching connectors so draft state resets. */
function ConnectorConfigEditor({
  connector,
  saving,
  error,
  onSave,
  onClear,
}: {
  connector: ConnectorRow;
  saving?: boolean;
  error?: string;
  onSave: (values: Record<string, string>) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const showForm = editing || !connector.configured;
  const complete = connector.configFields.every((f) => (draft[f.key] ?? "").trim() !== "");

  const inputStyle: React.CSSProperties = { width: "100%", height: 32, border: `1px solid ${color.borderStrong}`, borderRadius: 8, padding: "0 10px", font: `400 13px ${font.mono}`, outline: "none", background: color.surface, color: color.ink, boxSizing: "border-box" };
  const reset = () => { setDraft({}); setEditing(false); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!showForm && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {connector.configFields
              .filter((f) => !f.secret)
              .map((f) => (
                <span key={f.key} style={{ display: "block", fontSize: 12, color: color.muted, fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {connector.publicValues?.[f.key] ?? "—"}
                </span>
              ))}
          </span>
          <button onClick={() => setEditing(true)} className="ws-hoverable" style={{ height: 28, padding: "0 12px", background: color.surface, border: `1px solid ${color.borderStrong}`, borderRadius: 8, font: `500 12px ${font.sans}`, color: color.ink, cursor: "pointer" }}>
            Change
          </button>
          <button onClick={onClear} className="ws-hoverable" style={{ height: 28, padding: "0 12px", background: color.surface, border: `1px solid ${color.borderStrong}`, borderRadius: 8, font: `500 12px ${font.sans}`, color: color.statusDeclinedFg, cursor: "pointer" }}>
            Clear
          </button>
        </div>
      )}

      {showForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {!connector.configured && <span style={{ fontSize: 12, color: color.mutedLight }}>Not configured yet.</span>}
          {connector.configFields.map((f) => (
            <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{f.label}</span>
              <input
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                type={f.secret ? "password" : "text"}
                placeholder={f.placeholder}
                style={inputStyle}
              />
            </label>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                if (!complete) return;
                onSave(Object.fromEntries(connector.configFields.map((f) => [f.key, (draft[f.key] ?? "").trim()])));
                reset();
              }}
              disabled={saving || !complete}
              style={{ height: 32, padding: "0 16px", background: color.accent, border: "none", borderRadius: 8, font: `500 13px ${font.sans}`, color: "#fff", cursor: saving || !complete ? "default" : "pointer", opacity: saving || !complete ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {connector.configured && (
              <button onClick={reset} className="ws-hoverable" style={{ height: 32, padding: "0 16px", background: color.surface, border: `1px solid ${color.borderStrong}`, borderRadius: 8, font: `500 13px ${font.sans}`, color: color.ink, cursor: "pointer" }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: color.statusDeclinedFg }}>{error}</div>}
    </div>
  );
}

/** One row in the connectors list (left pane / narrow list). */
function ConnectorRow({ connector, active, onClick }: { connector: ConnectorRow; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ws-hoverable"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        width: "100%",
        padding: "9px 10px",
        borderRadius: 8,
        border: "none",
        background: active ? color.accentTint : "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: color.ink }}>{connector.name}</span>
      <span style={{ fontSize: 11, color: connector.configured ? color.muted : color.mutedLight }}>
        {connector.configured ? "Configured" : "Not configured"}
      </span>
    </button>
  );
}

/** Right-hand detail pane: the connector's name + description + docs link, then its config control. */
function ConnectorDetailPane({
  connector,
  saving,
  error,
  onSave,
  onClear,
}: {
  connector: ConnectorRow;
  saving?: boolean;
  error?: string;
  onSave: (connectorId: string, values: Record<string, string>) => void;
  onClear: (connectorId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{connector.name}</span>
        {connector.configured && <span style={{ fontSize: 11, color: color.muted }}>· Configured</span>}
      </div>
      <div style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55 }}>
        {connector.description}
        {connector.docsUrl && (
          <>
            {" "}
            <a href={connector.docsUrl} target="_blank" rel="noreferrer" style={{ color: color.accent }}>Where to find these</a>
          </>
        )}
      </div>
      <ConnectorConfigEditor
        key={connector.id}
        connector={connector}
        saving={saving}
        error={error}
        onSave={(values) => onSave(connector.id, values)}
        onClear={() => onClear(connector.id)}
      />
    </div>
  );
}

/** Wide-screen connectors view: a list on the left, the selected connector's config on the right. */
function ConnectorsMasterDetail({
  connectors,
  error,
  saving,
  activeConnector,
  onSelect,
  onSave,
  onClear,
}: {
  connectors?: ConnectorRow[];
  error?: string;
  saving?: boolean;
  activeConnector?: ConnectorRow;
  onSelect: (connectorId: string) => void;
  onSave: (connectorId: string, values: Record<string, string>) => void;
  onClear: (connectorId: string) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div className="ws-sb" style={{ width: 232, flex: "none", borderRight: `1px solid ${color.borderLight}`, overflowY: "auto", padding: "16px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: color.mutedLight, padding: "0 10px 6px" }}>Connectors</div>
        {connectors?.map((c) => (
          <ConnectorRow key={c.id} connector={c} active={c.id === activeConnector?.id} onClick={() => onSelect(c.id)} />
        ))}
        {!connectors && !error && <div style={{ fontSize: 12, color: color.muted, padding: "4px 10px" }}>Loading…</div>}
        {connectors?.length === 0 && <div style={{ fontSize: 12, color: color.muted, padding: "4px 10px" }}>None available.</div>}
      </div>

      <div className="ws-sb" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px 28px 30px" }}>
        {error && !connectors ? (
          <div style={{ fontSize: 12.5, color: color.statusDeclinedFg }}>Couldn't load connectors: {error}</div>
        ) : activeConnector ? (
          <ConnectorDetailPane connector={activeConnector} saving={saving} error={error} onSave={onSave} onClear={onClear} />
        ) : (
          <div style={{ fontSize: 12.5, color: color.muted }}>Select a connector to configure it.</div>
        )}
      </div>
    </div>
  );
}

function WorkspaceNameField({
  value,
  saving,
  error,
  onCommit,
}: {
  value: string;
  saving?: boolean;
  error?: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <>
      <input
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        style={inputBox}
      />
      {saving && <div style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>Saving…</div>}
      {error && <div style={{ fontSize: 12, color: color.statusDeclinedFg, marginTop: 6 }}>{error}</div>}
    </>
  );
}

function LimitRow({ title, sub, defaultValue, onCommit }: { title: string; sub: string; defaultValue: string; onCommit: (raw: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 12 }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: color.muted }}>{sub}</span>
      </span>
      <input
        defaultValue={defaultValue}
        onBlur={(e) => onCommit(e.target.value)}
        style={{ width: 96, height: 32, border: `1px solid ${color.borderStrong}`, borderRadius: 8, padding: "0 10px", font: `500 14px ${font.mono}`, color: color.ink, outline: "none", textAlign: "right" }}
      />
    </div>
  );
}
