import { useState } from "react";
import type { Channel, Member } from "@perch/core";
import { Avatar } from "./primitives/Avatar.js";
import { SegmentedControl } from "./primitives/SegmentedControl.js";
import { CloseIcon } from "./icons.js";
import { color, font, radius } from "./tokens.js";
import { avatarColorsFor } from "./utils.js";

type Tab = "channel" | "people" | "agent";
type Role = "member" | "admin";

const AGENT_TEMPLATES: { key: string; name: string; note: string; role: string; instructions: string }[] = [
  { key: "blank", name: "Blank", note: "No tools, no schedule. You wire it up.", role: "Agent", instructions: "You are a workspace agent. Wait for instructions." },
  {
    key: "reporting",
    name: "Reporting",
    note: "Warehouse reads, scheduled digests.",
    role: "Agent · Research & digests",
    instructions: "Read the sources you're given, summarise what changed, and post a short digest. Never write anywhere without being asked.",
  },
  {
    key: "oncall",
    name: "On-call",
    note: "Logs, restarts, paging inside one namespace.",
    role: "Agent · Reliability",
    instructions: "Watch error budgets for the service you're assigned. Investigate first, act only inside your blast radius, and page a human for anything wider.",
  },
];

/**
 * The redesign's unified "Add to {workspace}" modal — Channel / People / Agent tabs covering the
 * common cases. The Agent tab's "Advanced setup" link hands off to the full AddMemberScreen for
 * plugin import, tool grants, model, skills, and triggers.
 */
export function AddToWorkspaceModal({
  tab,
  onTabChange,
  workspaceName,
  channels,
  members,
  currentUserId,
  ownerName,
  busy,
  error,
  onClose,
  onCreateChannel,
  onInvitePeople,
  onCreateAgent,
  onAdvancedAgentSetup,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  workspaceName: string;
  channels: Channel[];
  members: Member[];
  currentUserId: string;
  ownerName?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onCreateChannel: (name: string, topic: string | undefined, memberIds: string[]) => void;
  onInvitePeople: (emails: string[], role: Role, channelIds: string[]) => void;
  onCreateAgent: (draft: { name: string; roleDescription: string; instructions: string; channelIds: string[] }) => void;
  onAdvancedAgentSetup: () => void;
}) {
  // Channel tab
  const [chName, setChName] = useState("");
  const [chTopic, setChTopic] = useState("");
  const [chMemberIds, setChMemberIds] = useState<Set<string>>(new Set());
  const toggleChMember = (id: string) =>
    setChMemberIds((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  // People tab
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [role, setRole] = useState<Role>("member");
  // Agent tab
  const [template, setTemplate] = useState(AGENT_TEMPLATES[1]!.key);
  const [agentName, setAgentName] = useState("Beacon");
  // shared channel chips
  const [channelIds, setChannelIds] = useState<Set<string>>(new Set(channels.slice(0, 1).map((c) => c.id)));
  const toggleChannel = (id: string) => setChannelIds((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const otherMembers = members.filter((m) => m.id !== currentUserId);

  const commitEmail = () => {
    const e = emailDraft.trim().toLowerCase();
    if (e && /.+@.+\..+/.test(e) && !emails.includes(e)) setEmails([...emails, e]);
    setEmailDraft("");
  };

  const cta = tab === "channel" ? "Create channel" : tab === "people" ? "Send invites" : "Add agent";
  const footNote =
    tab === "channel" ? "Agents you add inherit their own autonomy setting." : tab === "people" ? "Invites expire after 14 days." : "You will be its owner and approver.";
  const canSubmit = tab === "channel" ? !!chName.trim() : tab === "people" ? emails.length > 0 : !!agentName.trim();

  const submit = () => {
    if (tab === "channel") onCreateChannel(chName.trim(), chTopic.trim() || undefined, [...chMemberIds]);
    else if (tab === "people") onInvitePeople(emails, role, [...channelIds]);
    else {
      const t = AGENT_TEMPLATES.find((x) => x.key === template)!;
      onCreateAgent({ name: agentName.trim(), roleDescription: t.role, instructions: t.instructions, channelIds: [...channelIds] });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(20,17,38,0.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: color.surface, borderRadius: 14, boxShadow: "0 26px 60px rgba(23,20,42,0.34)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 16px 0 18px" }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>Add to {workspaceName}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} className="ws-hoverable" style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 7, cursor: "pointer" }}>
            <CloseIcon size={14} stroke={color.muted} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 3, padding: "12px 18px 0" }}>
          {(["channel", "people", "agent"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                textTransform: "capitalize",
                color: tab === t ? color.ink : color.muted,
                background: tab === t ? "#F1EFF8" : "transparent",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px 20px" }}>
          {tab === "channel" && (
            <>
              <Label>Channel name</Label>
              <div style={{ display: "flex", alignItems: "center", height: 34, border: `1px solid ${color.borderStrong}`, borderRadius: 8, overflow: "hidden" }}>
                <span style={{ padding: "0 2px 0 11px", fontSize: 15, color: color.mutedLight }}>#</span>
                <input value={chName} onChange={(e) => setChName(e.target.value)} placeholder="pricing-2027" style={{ ...inputBare }} />
              </div>
              <Label style={{ marginTop: 16 }}>Topic</Label>
              <input value={chTopic} onChange={(e) => setChTopic(e.target.value)} placeholder="What this channel is for" style={inputBox} />
              <Label style={{ marginTop: 16 }}>Add members</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {otherMembers.map((m) => {
                  const pal = avatarColorsFor(m);
                  const on = chMemberIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleChMember(m.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        height: 30,
                        padding: "0 11px 0 5px",
                        borderRadius: 20,
                        border: `1px solid ${on ? "#D9D1F6" : color.borderStrong}`,
                        background: on ? color.agentTagBg : color.surface,
                        color: on ? color.accentText : color.mutedDark,
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={20} square={m.kind === "agent"} />
                      {m.name.split(" ")[0]}
                    </button>
                  );
                })}
                {otherMembers.length === 0 && <span style={{ fontSize: 12.5, color: color.mutedLight }}>No one else in the workspace yet.</span>}
              </div>
            </>
          )}

          {tab === "people" && (
            <>
              <Label>Email addresses</Label>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: 76, padding: 9, border: `1px solid ${color.borderStrong}`, borderRadius: 9, alignContent: "flex-start" }}>
                {emails.map((e) => (
                  <span key={e} style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 6px 0 9px", borderRadius: 20, background: color.agentTagBg, border: `1px solid ${color.agentTagBorder}`, fontSize: 12.5, color: color.accentText }}>
                    {e}
                    <button onClick={() => setEmails(emails.filter((x) => x !== e))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.7 }}>
                      <CloseIcon size={11} stroke={color.accentText} />
                    </button>
                  </span>
                ))}
                <input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), commitEmail())}
                  onBlur={commitEmail}
                  placeholder="name@company.com"
                  style={{ flex: 1, minWidth: 160, height: 26, border: 0, outline: "none", fontSize: 13, background: "transparent" }}
                />
              </div>
              <Label style={{ marginTop: 16 }}>Role</Label>
              <SegmentedControl
                style={{ width: "fit-content" }}
                value={role}
                onChange={setRole}
                options={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                ]}
              />
              <Note>
                {role === "admin"
                  ? "Admins can change any agent's autonomy and approve tools they don't own."
                  : "Members can add agents they own and approve tools in channels they belong to."}
              </Note>
              <Label style={{ marginTop: 16 }}>Add to channels</Label>
              <ChannelChips channels={channels} selected={channelIds} onToggle={toggleChannel} />
            </>
          )}

          {tab === "agent" && (
            <>
              <Label>Start from</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {AGENT_TEMPLATES.map((t) => {
                  const on = template === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTemplate(t.key)}
                      style={{ textAlign: "left", border: `1px solid ${on ? "#C9BEF2" : color.border}`, background: on ? "#F7F5FE" : color.surface, borderRadius: 10, padding: 11, cursor: "pointer" }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: color.muted, lineHeight: 1.5 }}>{t.note}</div>
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Label>Agent name</Label>
                  <input value={agentName} onChange={(e) => setAgentName(e.target.value)} style={inputBox} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Label>Owner</Label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 11px", border: `1px solid ${color.borderStrong}`, borderRadius: 8, fontSize: 13, color: color.mutedDark }}>
                    {ownerName ?? "You"}
                  </div>
                </div>
              </div>

              <Label style={{ marginTop: 16 }}>Add to channels</Label>
              <ChannelChips channels={channels} selected={channelIds} onToggle={toggleChannel} />

              <button
                onClick={onAdvancedAgentSetup}
                className="ws-hoverable"
                style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", border: `1px solid ${color.borderStrong}`, borderRadius: 8, background: color.surface, fontSize: 12.5, color: color.mutedDark, cursor: "pointer" }}
              >
                Advanced setup — tools, model, skills & triggers
              </button>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 18px", borderTop: `1px solid ${color.borderLight}`, background: color.approvalBg }}>
          <span style={{ fontSize: 12.5, color: error ? color.statusDeclinedFg : color.mutedLight }}>{error ?? footNote}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} className="ws-hoverable" style={{ height: 32, padding: "0 13px", border: `1px solid ${color.borderStrong}`, borderRadius: 8, fontSize: 13, color: color.mutedDark, cursor: "pointer", background: color.surface }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !canSubmit}
            style={{ height: 32, padding: "0 14px", borderRadius: 8, border: "none", background: busy || !canSubmit ? color.borderStrong : color.accent, color: "#fff", fontSize: 13, fontWeight: 500, cursor: busy || !canSubmit ? "default" : "pointer" }}
          >
            {busy ? "Working…" : cta}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelChips({ channels, selected, onToggle }: { channels: Channel[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {channels.map((c) => {
        const on = selected.has(c.id);
        return (
          <button
            key={c.id}
            onClick={() => onToggle(c.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 11px",
              borderRadius: 20,
              border: `1px solid ${on ? "#D9D1F6" : color.borderStrong}`,
              background: on ? color.agentTagBg : color.surface,
              color: on ? color.accentText : color.mutedDark,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            #{c.name}
            {on && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </button>
        );
      })}
      {channels.length === 0 && <span style={{ fontSize: 12.5, color: color.mutedLight }}>No channels yet.</span>}
    </div>
  );
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 12.5, fontWeight: 500, color: "#413D4E", marginBottom: 6, ...style }}>{children}</div>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 8, fontSize: 12.5, color: color.muted, lineHeight: 1.6 }}>{children}</div>;
}

const inputBare: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  padding: "0 9px",
  border: 0,
  fontSize: 13.5,
  background: color.surface,
  outline: "none",
  fontFamily: font.sans,
};
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
  color: color.ink,
};
