import { useState } from "react";
import type { AgentMember, SkillDoc, ToolGrant } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { Card, SectionLabel } from "../primitives/Card.js";
import { SegmentedControl } from "../primitives/SegmentedControl.js";
import { color, font, radius } from "../tokens.js";
import { ModelSelect, type ModelOption, type ToolOption } from "./AddMemberScreen.js";

const inputStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: radius.md, border: `1px solid ${color.border}`, background: color.surface, font: `13px ${font.sans}`, color: color.ink };
const textareaStyle: React.CSSProperties = { ...inputStyle, fontFamily: font.mono, fontSize: 12, resize: "vertical", minHeight: 90 };

export type GoogleWorkspaceConnection = { connected: boolean; email?: string; scopes?: string[]; connectedAt?: string };

/** Tools whose grant alone isn't enough — the agent also needs a per-tool OAuth connection before
 * it can actually do anything with the grant. Currently just Google Workspace; the "Connect …"
 * card below is generic over this list so a future connected tool doesn't need its own UI. */
const CONNECTABLE_TOOL_NAMES = ["gmail", "calendar"];

export function AgentDetailScreen({
  agent,
  busy,
  error,
  published,
  availableTools,
  toolsSaving,
  availableModels,
  modelSaving,
  skillsSaving,
  instructionsSaving,
  roleDescriptionSaving,
  googleWorkspaceConnection,
  googleWorkspaceConnecting,
  googleWorkspaceDisconnecting,
  googleWorkspaceError,
  onBack,
  onPublish,
  onSaveTools,
  onSaveModel,
  onSaveSkills,
  onSaveInstructions,
  onSaveRoleDescription,
  uiSaving,
  onSaveUiEnabled,
  onConnectGoogleWorkspace,
  onDisconnectGoogleWorkspace,
}: {
  agent: AgentMember;
  busy?: boolean;
  error?: string;
  published?: { name: string; version: string };
  availableTools: ToolOption[];
  toolsSaving?: boolean;
  availableModels: ModelOption[];
  modelSaving?: boolean;
  skillsSaving?: boolean;
  instructionsSaving?: boolean;
  roleDescriptionSaving?: boolean;
  googleWorkspaceConnection?: GoogleWorkspaceConnection;
  googleWorkspaceConnecting?: boolean;
  googleWorkspaceDisconnecting?: boolean;
  googleWorkspaceError?: string;
  onBack: () => void;
  onPublish: () => void;
  onSaveTools: (tools: ToolGrant[]) => void;
  onSaveModel: (model: string) => void;
  onSaveSkills: (skills: SkillDoc[]) => void;
  onSaveInstructions: (instructions: string) => void;
  onSaveRoleDescription: (roleDescription: string) => void;
  uiSaving?: boolean;
  onSaveUiEnabled: (enabled: boolean) => void;
  onConnectGoogleWorkspace?: () => void;
  onDisconnectGoogleWorkspace?: () => void;
}) {
  const [editingTools, setEditingTools] = useState(false);
  const [toolDraft, setToolDraft] = useState<string[]>(() => agent.config.tools.map((t) => t.toolName));

  const startEditingTools = () => {
    setToolDraft(agent.config.tools.map((t) => t.toolName));
    setEditingTools(true);
  };
  const toggleTool = (name: string) => setToolDraft((names) => (names.includes(name) ? names.filter((n) => n !== name) : [...names, name]));
  // A tool this agent was granted before it stopped being offered (e.g. removed from
  // availableTools because it was never actually wired to a backend) — without this, it'd stay
  // stuck granted forever, since the checkbox grid below only renders `availableTools` and has no
  // other way to un-grant something not on that list.
  const legacyTools: ToolOption[] = agent.config.tools
    .filter((t) => !availableTools.some((a) => a.name === t.toolName))
    .map((t) => ({ name: t.toolName, desc: "No longer offered — uncheck to remove", needsApproval: t.needsApproval }));
  const saveTools = () => {
    const approvalByName = new Map(agent.config.tools.map((t) => [t.toolName, t.needsApproval]));
    onSaveTools(toolDraft.map((toolName) => ({ toolName, needsApproval: approvalByName.get(toolName) ?? false })));
    setEditingTools(false);
  };

  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState<string>(agent.config.model);
  const startEditingModel = () => {
    setModelDraft(agent.config.model);
    setEditingModel(true);
  };
  const saveModel = () => {
    onSaveModel(modelDraft);
    setEditingModel(false);
  };

  const [editingSkills, setEditingSkills] = useState(false);
  const [skillsDraft, setSkillsDraft] = useState<SkillDoc[]>(agent.config.skills);
  const startEditingSkills = () => {
    setSkillsDraft(agent.config.skills);
    setEditingSkills(true);
  };
  const updateSkillDraft = (index: number, patch: Partial<SkillDoc>) =>
    setSkillsDraft((skills) => skills.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const removeSkillDraft = (index: number) => setSkillsDraft((skills) => skills.filter((_, i) => i !== index));
  const addSkillDraft = () => setSkillsDraft((skills) => [...skills, { name: "", description: "", body: "" }]);
  const saveSkills = () => {
    onSaveSkills(skillsDraft.filter((s) => s.name.trim() && s.description.trim() && s.body.trim()));
    setEditingSkills(false);
  };

  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState(agent.config.instructions);
  const startEditingInstructions = () => {
    setInstructionsDraft(agent.config.instructions);
    setEditingInstructions(true);
  };
  const saveInstructions = () => {
    const next = instructionsDraft.trim();
    if (next && next !== agent.config.instructions) onSaveInstructions(next);
    setEditingInstructions(false);
  };

  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState(agent.roleDescription);
  const startEditingRole = () => {
    setRoleDraft(agent.roleDescription);
    setEditingRole(true);
  };
  const saveRole = () => {
    const next = roleDraft.trim();
    if (next && next !== agent.roleDescription) onSaveRoleDescription(next);
    setEditingRole(false);
  };

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Agent</h1>
        <span style={{ flex: 1 }} />
        {error && <span style={{ fontSize: 12, color: color.statusDeclinedFg, maxWidth: 320 }}>{error}</span>}
        {published && <span style={{ fontSize: 12, color: color.muted, fontFamily: font.mono }}>{published.name}@{published.version}</span>}
        <Button variant="primary" disabled={busy} onClick={onPublish}>
          {busy ? "Publishing…" : "Publish as plugin"}
        </Button>
      </header>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Avatar mono={agent.mono} bg={agent.colorBg} fg={agent.colorFg} size={56} square />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{agent.name}</div>
              {editingRole ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: color.muted, flex: "none" }}>@{agent.handle} ·</span>
                  <input
                    autoFocus
                    value={roleDraft}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRole();
                      if (e.key === "Escape") setEditingRole(false);
                    }}
                    placeholder="What this agent does"
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                  <Button variant="primary" disabled={roleDescriptionSaving || !roleDraft.trim()} onClick={saveRole}>
                    {roleDescriptionSaving ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="secondary" disabled={roleDescriptionSaving} onClick={() => setEditingRole(false)}>Cancel</Button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: color.muted, overflow: "hidden", textOverflow: "ellipsis" }}>@{agent.handle} · {agent.roleDescription}</span>
                  <button
                    onClick={startEditingRole}
                    className="ws-hoverable"
                    style={{ flex: "none", background: "none", border: "none", padding: "2px 4px", borderRadius: radius.sm, font: `500 12px ${font.sans}`, color: color.accent, cursor: "pointer" }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <SectionLabel>Instructions</SectionLabel>
            <span style={{ flex: 1 }} />
            {!editingInstructions && (
              <Button variant="secondary" onClick={startEditingInstructions}>Edit</Button>
            )}
          </div>

          {editingInstructions ? (
            <>
              <div style={{ fontSize: 12, color: color.muted, marginBottom: 12 }}>
                The agent's system prompt — everything it should know and how it should behave.
              </div>
              <textarea
                autoFocus
                value={instructionsDraft}
                onChange={(e) => setInstructionsDraft(e.target.value)}
                style={{ ...textareaStyle, width: "100%", minHeight: 200, marginBottom: 12, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" disabled={instructionsSaving || !instructionsDraft.trim()} onClick={saveInstructions}>
                  {instructionsSaving ? "Saving…" : "Save"}
                </Button>
                <Button variant="secondary" disabled={instructionsSaving} onClick={() => setEditingInstructions(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{agent.config.instructions}</div>
          )}
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <SectionLabel>Tools</SectionLabel>
            <span style={{ flex: 1 }} />
            {!editingTools && (
              <Button variant="secondary" onClick={startEditingTools}>Edit</Button>
            )}
          </div>

          {editingTools ? (
            <>
              <div style={{ fontSize: 12, color: color.muted, marginBottom: 12 }}>Anything not checked here, the agent cannot do.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[...availableTools, ...legacyTools].map((t) => {
                  const on = toolDraft.includes(t.name);
                  return (
                    <button
                      key={t.name}
                      onClick={() => toggleTool(t.name)}
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
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" disabled={toolsSaving} onClick={saveTools}>{toolsSaving ? "Saving…" : "Save"}</Button>
                <Button variant="secondary" disabled={toolsSaving} onClick={() => setEditingTools(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.config.tools.map((t) => (
                <div key={t.toolName} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: font.mono }}>
                  <span>{t.toolName}</span>
                  {t.needsApproval && (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: color.approvalFg, background: color.approvalBg, borderRadius: 5, padding: "2px 6px", fontFamily: font.sans }}>
                      Approval
                    </span>
                  )}
                </div>
              ))}
              {agent.config.tools.length === 0 && <div style={{ fontSize: 13, color: color.mutedLight }}>No tools granted.</div>}
            </div>
          )}
        </Card>

        <Card>
          <SectionLabel>Chat UI cards</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.muted, lineHeight: 1.5 }}>
              Lets this agent render structured cards — tables, checklists, status, callouts — in the chat instead of
              plain text, via the standard <span style={{ fontFamily: font.mono }}>render_ui</span> capability. Turn off
              for an agent that should only ever reply in prose.
            </div>
            <SegmentedControl
              value={agent.config.ui?.enabled === false ? "off" : "on"}
              onChange={(v) => {
                if (!uiSaving) onSaveUiEnabled(v === "on");
              }}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              style={{ flex: "none", width: 132, opacity: uiSaving ? 0.6 : 1 }}
            />
          </div>
        </Card>

        {agent.config.tools.some((t) => CONNECTABLE_TOOL_NAMES.includes(t.toolName)) && (
          <Card>
            <SectionLabel>Google Workspace</SectionLabel>
            <div style={{ fontSize: 12, color: color.muted, marginBottom: 12, marginTop: -8 }}>
              This agent's Gmail/Calendar tools act as one person's own Google account — connect the account this agent should use.
            </div>
            {googleWorkspaceError && (
              <div style={{ fontSize: 12, color: color.statusDeclinedFg, marginBottom: 8 }}>{googleWorkspaceError}</div>
            )}
            {googleWorkspaceConnection?.connected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13 }}>
                  Connected as <span style={{ fontFamily: font.mono, fontWeight: 600 }}>{googleWorkspaceConnection.email}</span>
                </span>
                <span style={{ flex: 1 }} />
                <Button variant="secondary" disabled={googleWorkspaceDisconnecting} onClick={onDisconnectGoogleWorkspace}>
                  {googleWorkspaceDisconnecting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            ) : (
              <Button variant="primary" disabled={googleWorkspaceConnecting} onClick={onConnectGoogleWorkspace}>
                {googleWorkspaceConnecting ? "Connecting…" : "Connect Gmail & Calendar"}
              </Button>
            )}
          </Card>
        )}

        <Card>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <SectionLabel>Model &amp; guardrails</SectionLabel>
            <span style={{ flex: 1 }} />
            {!editingModel && (
              <Button variant="secondary" onClick={startEditingModel}>Edit</Button>
            )}
          </div>

          {editingModel ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <ModelSelect models={availableModels} value={modelDraft} onChange={setModelDraft} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="primary" disabled={modelSaving} onClick={saveModel}>{modelSaving ? "Saving…" : "Save"}</Button>
                <Button variant="secondary" disabled={modelSaving} onClick={() => setEditingModel(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <div><span style={{ color: color.muted }}>Model:</span> <span style={{ fontFamily: font.mono }}>{agent.config.model}</span></div>
              <div><span style={{ color: color.muted }}>Daily spend cap:</span> ${agent.config.dailySpendCapUsd.toFixed(2)}</div>
            </div>
          )}
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <SectionLabel>Skills</SectionLabel>
            <span style={{ flex: 1 }} />
            {!editingSkills && (
              <Button variant="secondary" onClick={startEditingSkills}>Edit</Button>
            )}
          </div>

          {editingSkills ? (
            <>
              <div style={{ fontSize: 12, color: color.muted, marginBottom: 12 }}>
                Named capability docs added to this agent's instructions when it runs. Published alongside the agent as separate SKILL.md files.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {skillsDraft.map((skill, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        placeholder="skill-name"
                        value={skill.name}
                        onChange={(e) => updateSkillDraft(i, { name: e.target.value })}
                        style={{ ...inputStyle, flex: 1, fontFamily: font.mono }}
                      />
                      <Button variant="secondary" onClick={() => removeSkillDraft(i)}>Remove</Button>
                    </div>
                    <input
                      placeholder="Short description"
                      value={skill.description}
                      onChange={(e) => updateSkillDraft(i, { description: e.target.value })}
                      style={inputStyle}
                    />
                    <textarea
                      placeholder="Skill content (markdown)"
                      value={skill.body}
                      onChange={(e) => updateSkillDraft(i, { body: e.target.value })}
                      style={textareaStyle}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" onClick={addSkillDraft}>Add skill</Button>
                <span style={{ flex: 1 }} />
                <Button variant="primary" disabled={skillsSaving} onClick={saveSkills}>{skillsSaving ? "Saving…" : "Save"}</Button>
                <Button variant="secondary" disabled={skillsSaving} onClick={() => setEditingSkills(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.config.skills.map((s) => (
                <div key={s.name} style={{ fontSize: 13 }}>
                  <span style={{ fontFamily: font.mono, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: color.muted }}> — {s.description}</span>
                </div>
              ))}
              {agent.config.skills.length === 0 && <div style={{ fontSize: 13, color: color.mutedLight }}>No skills added.</div>}
            </div>
          )}
        </Card>

        <div style={{ fontSize: 12, color: color.mutedLight, borderRadius: radius.lg, padding: "0 2px" }}>
          Publishing packages this agent's instructions and configuration as an
          <code style={{ margin: "0 4px" }}>agent-plugins.org</code>
          plugin and stores it in the shared plugins bucket, where any teammate can import it from
          "Add member → Agent".
        </div>
      </div>
    </div>
  );
}
