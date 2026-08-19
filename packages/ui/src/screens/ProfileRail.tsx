import { useState } from "react";
import type { Member, Task } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { SegmentedControl } from "../primitives/SegmentedControl.js";
import { CloseIcon, DotsIcon, SlidersIcon, ThreadsIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor } from "../utils.js";

type Autonomy = "read" | "ask" | "auto";

/** Decorative usage sparkbars — real per-day agent spend isn't metered yet. */
const USAGE_BARS = [22, 38, 30, 54, 41, 26, 12, 44, 62, 49, 71, 58, 88, 66];

function monthStartLabel() {
  const d = new Date();
  return d.toLocaleDateString([], { month: "short", day: "numeric" }).replace(/\d+$/, "1");
}

const AUTONOMY_NOTE: Record<Autonomy, string> = {
  read: "Can read data and draft replies, but cannot write anywhere or call a tool that changes state.",
  ask: "Every tool outside the allowlist stops here and asks a human in the channel. Requests expire after 15 minutes.",
  auto: "Runs any allowlisted tool without asking. Tools marked Ask still stop for a human.",
};

/**
 * The redesign's right rail: an agent's config-at-a-glance or a person's profile. Rendered by
 * App.tsx when a member is selected (via the sidebar agents list, a message avatar, or the
 * channel header). The autonomy control is local-only for now — per-channel autonomy isn't
 * modelled in the backend (`workspace.approvalPolicy` is workspace-wide and orthogonal).
 */
export function ProfileRail({
  member,
  channelName,
  tasks,
  spendToday,
  toolCount,
  ownerName,
  ownedAgents,
  onClose,
  onMessage,
  onConfigure,
  onOpenAgent,
  bare,
}: {
  member: Member;
  channelName?: string;
  tasks: Task[];
  spendToday?: number;
  toolCount: number;
  ownerName?: string;
  ownedAgents: { id: string; name: string; mono: string; role: string; colorBg: string; colorFg: string }[];
  onClose: () => void;
  onMessage: () => void;
  onConfigure: () => void;
  onOpenAgent: (id: string) => void;
  /** Rendered inside a Dialog on mobile — drops the sticky header row. */
  bare?: boolean;
}) {
  const [autonomy, setAutonomy] = useState<Autonomy>("ask");
  const isAgent = member.kind === "agent";
  const pal = paletteFor(member.id);
  const openTasks = tasks.filter((t) => t.ownerId === member.id && t.status !== "done");

  return (
    <aside style={{ height: "100%", display: "flex", flexDirection: "column", background: "#FDFDFE", borderLeft: bare ? "none" : `1px solid ${color.border}`, overflow: "hidden" }}>
      {!bare && (
        <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 12px 0 16px", borderBottom: `1px solid ${color.borderLight}` }}>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isAgent ? `${member.name} · agent profile` : member.name}
          </span>
          <span style={{ flex: 1 }} />
          <button className="ws-hoverable" style={hdrBtn} title="More">
            <DotsIcon size={15} stroke={color.muted} />
          </button>
          <button onClick={onClose} className="ws-hoverable" style={hdrBtn} title="Close panel">
            <CloseIcon size={13} stroke={color.muted} />
          </button>
        </div>
      )}

      <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isAgent ? (
          <>
            <div style={{ padding: "20px 18px 18px", borderBottom: `1px solid ${color.borderLight}` }}>
              <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
                <Avatar mono={member.mono} bg={pal.bg} fg={pal.fg} size={52} square />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{member.name}</span>
                    <AgentBadge />
                  </div>
                  <div style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>{member.roleDescription}</div>
                </div>
              </div>
              {ownerName && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: color.muted }}>
                  Owned by {ownerName}
                  {channelName ? ` · invokable in #${channelName}` : ""}
                </div>
              )}
            </div>

            <Section title={channelName ? "Autonomy in this channel" : "Autonomy"}>
              <SegmentedControl
                value={autonomy}
                onChange={setAutonomy}
                options={[
                  { value: "read", label: "Read-only" },
                  { value: "ask", label: "Ask first" },
                  { value: "auto", label: "Auto" },
                ]}
              />
              <div style={{ marginTop: 9, fontSize: 12.5, color: color.muted, lineHeight: 1.5 }}>{AUTONOMY_NOTE[autonomy]}</div>
            </Section>

            <Section title="Tools" trailing={`${toolCount} connected`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {member.config.tools.map((t) => (
                  <div key={t.toolName} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", margin: "0 -8px", borderRadius: radius.md }}>
                    <span style={{ font: `400 12.5px ${font.mono}`, color: "#413D4E" }}>{t.toolName}</span>
                    <span style={{ flex: 1 }} />
                    {t.needsApproval ? (
                      <StatePill bg={color.statusInProgressBg} fg={color.statusInProgressFg}>Ask</StatePill>
                    ) : (
                      <StatePill bg={color.statusDoneBg} fg={color.statusDoneFg}>Allowed</StatePill>
                    )}
                  </div>
                ))}
                {member.config.tools.length === 0 && <div style={{ fontSize: 12.5, color: color.mutedLight }}>No tools granted.</div>}
              </div>
            </Section>

            <Section title="Assigned tasks" trailing={`${openTasks.length} open`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {openTasks.map((t) => (
                  <div key={t.id} style={{ border: `1px solid ${color.border}`, borderRadius: 9, padding: "9px 10px" }}>
                    <div style={{ fontSize: 13, lineHeight: 1.45 }}>{t.title}</div>
                    {t.dueLabel && <div style={{ marginTop: 6, fontSize: 12, color: color.mutedLight }}>{t.dueLabel}</div>}
                  </div>
                ))}
                {openTasks.length === 0 && <div style={{ fontSize: 12.5, color: color.mutedLight }}>Nothing assigned.</div>}
              </div>
            </Section>

            <Section title="Usage this month">
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>${(spendToday ?? 0).toFixed(2)}</span>
                <span style={{ fontSize: 12.5, color: color.muted }}>today · cap ${member.config.dailySpendCapUsd.toFixed(2)}/day</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40, marginTop: 12 }}>
                {USAGE_BARS.map((h, i) => (
                  <div key={i} style={{ flex: 1, borderRadius: "3px 3px 0 0", background: "#DCD7F3", height: `${h}%` }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, font: `400 11px ${font.mono}`, color: color.mutedLight }}>
                <span>{monthStartLabel()}</span>
                <span>today</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: color.mutedLight }}>Per-day history is illustrative until run metering lands.</div>
            </Section>
          </>
        ) : (
          <>
            <div style={{ padding: "26px 18px 20px", textAlign: "center", borderBottom: `1px solid ${color.borderLight}` }}>
              <div style={{ margin: "0 auto" }}>
                <Avatar mono={member.mono} bg={pal.bg} fg={pal.fg} size={96} />
              </div>
              <div style={{ fontSize: 19, fontWeight: 600, marginTop: 14 }}>{member.name}</div>
              <div style={{ fontSize: 13, color: color.muted, marginTop: 3, textTransform: "capitalize" }}>{member.role}</div>
            </div>
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, borderBottom: `1px solid ${color.borderLight}` }}>
              {[
                ["Email", member.email],
                ["Role", member.role],
                ["Joined", new Date(member.createdAt).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })],
                ["Status", "Active"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13, color: "#413D4E" }}>
                  <span style={{ width: 74, flex: "none", color: color.mutedLight, fontSize: 12.5, textTransform: "capitalize" }}>{k}</span>
                  <span style={{ textTransform: k === "Role" || k === "Status" ? "capitalize" : "none" }}>{v}</span>
                </div>
              ))}
            </div>
            {ownedAgents.length > 0 && (
              <Section title="Agents they own">
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {ownedAgents.map((a) => (
                    <button key={a.id} onClick={() => onOpenAgent(a.id)} className="ws-hoverable" style={{ display: "flex", alignItems: "center", gap: 9, border: `1px solid ${color.border}`, borderRadius: 9, padding: "9px 10px", cursor: "pointer", background: "none", textAlign: "left" }}>
                      <Avatar mono={a.mono} bg={a.colorBg} fg={a.colorFg} size={22} square />
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: color.mutedLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{a.role}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      <div style={{ flex: "none", display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${color.borderLight}`, background: color.surface }}>
        <button onClick={onMessage} className="ws-hoverable" style={footBtn}>
          <ThreadsIcon size={14} stroke={color.mutedDark} />
          Message
        </button>
        {isAgent && (
          <button onClick={onConfigure} className="ws-hoverable" style={footBtn}>
            <SlidersIcon size={14} stroke={color.mutedDark} />
            Configure
          </button>
        )}
      </div>
    </aside>
  );
}

function Section({ title, trailing, children }: { title: string; trailing?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", borderBottom: `1px solid ${color.borderLight}` }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 9 }}>
        <span style={{ font: `500 11.5px ${font.sans}`, letterSpacing: "0.03em", textTransform: "uppercase", color: color.mutedLight }}>{title}</span>
        <span style={{ flex: 1 }} />
        {trailing && <span style={{ fontSize: 12.5, color: color.muted }}>{trailing}</span>}
      </div>
      {children}
    </div>
  );
}

function StatePill({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <span style={{ fontSize: 11.5, color: fg, background: bg, border: `1px solid ${fg}22`, padding: "2px 7px", borderRadius: 20 }}>
      {children}
    </span>
  );
}

const hdrBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
};

const footBtn: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: 34,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  background: color.surface,
  color: color.ink,
};
