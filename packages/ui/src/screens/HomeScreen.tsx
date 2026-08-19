import type { Channel, Member, Message, Task } from "@fizz/core";
import { Avatar } from "../primitives/Avatar.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { InviteIcon, MenuIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor, relativeTime } from "../utils.js";

/**
 * Landing view from the redesign — a daily briefing built around what the workspace's agents did
 * overnight and what needs a human. Sections map to real data: "Waiting on you" = the current
 * user's open + needs-approval tasks; "Overnight from your agents" = recent agent messages;
 * "Jump back in" = channels with their latest line.
 */
export function HomeScreen({
  currentUserId,
  currentUserName,
  tasks,
  membersById,
  channelsById,
  recentMessages,
  spendTodayUsd,
  spendCapUsd,
  onOpenRun,
  onGoTasks,
  onOpenChannel,
  onInvite,
  isNarrow,
  onOpenSidebar,
}: {
  currentUserId: string;
  currentUserName: string;
  tasks: Task[];
  membersById: Record<string, Member>;
  channelsById: Record<string, Channel>;
  recentMessages: Message[];
  spendTodayUsd: number;
  spendCapUsd: number;
  onOpenRun: (runId: string) => void;
  onGoTasks: () => void;
  onOpenChannel: (channelId: string) => void;
  onInvite: () => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const firstName = currentUserName.trim().split(/\s+/)[0] ?? currentUserName;

  const waiting = tasks
    .filter((t) => (t.ownerId === currentUserId && t.status === "open") || t.status === "needs_approval")
    .slice(0, 5);
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "declined");
  const agentActivity = recentMessages
    .filter((m) => !m.isSystem && !m.deletedAt && m.text && m.authorId && membersById[m.authorId]?.kind === "agent")
    .slice(-5)
    .reverse();

  const summary =
    waiting.length === 0
      ? "Nothing needs a decision from you right now."
      : `${waiting.length} ${waiting.length === 1 ? "thing needs" : "things need"} a decision from you.`;

  const stats = [
    { label: "Open tasks", value: String(openTasks.length), note: `${tasks.filter((t) => t.status === "in_progress").length} in progress` },
    { label: "Spend today", value: `$${spendTodayUsd.toFixed(2)}`, note: spendCapUsd ? `cap is $${spendCapUsd.toFixed(0)}/day` : "no cap set" },
    { label: "Waiting on you", value: String(waiting.length), note: waiting.length ? "in the list below" : "you're clear" },
  ];

  const jumpChannels = Object.values(channelsById)
    .filter((c) => c.kind !== "direct")
    .slice(0, 4);
  const lastLineFor = (channelId: string) => {
    const m = [...recentMessages].reverse().find((x) => x.channelId === channelId && x.text && !x.isSystem && !x.deletedAt);
    if (!m) return "";
    const who = m.authorId ? membersById[m.authorId]?.name.split(" ")[0] : undefined;
    return who ? `${who}: ${m.text}` : m.text!;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: `1px solid ${color.borderLight}` }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: "nowrap" }}>Home</span>
        {!isNarrow && (
          <>
            <span style={{ width: 1, height: 18, background: color.borderStrong }} />
            <span style={{ fontSize: 13, color: color.muted, whiteSpace: "nowrap" }}>{todayLabel()}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={onInvite}
          className="ws-hoverable"
          style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 11px", border: `1px solid ${color.borderStrong}`, borderRadius: 8, fontSize: 13, color: "#33333B", cursor: "pointer", background: color.surface }}
        >
          <InviteIcon size={14} stroke={color.mutedDark} />
          Invite
        </button>
      </header>

      <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "26px 0 30px" }}>
        <div style={{ maxWidth: 860, padding: "0 26px", display: "flex", flexDirection: "column", gap: 26 }}>
          <div>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Good {timeOfDay()}, {firstName}
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: color.mutedDark, lineHeight: 1.6, maxWidth: 620 }}>{summary}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: "13px 14px" }}>
                <div style={{ fontSize: 11.5, color: color.mutedLight, letterSpacing: "0.03em", textTransform: "uppercase", fontWeight: 500 }}>{s.label}</div>
                <div style={{ marginTop: 7, fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.value}</div>
                <div style={{ marginTop: 3, fontSize: 12.5, color: color.muted }}>{s.note}</div>
              </div>
            ))}
          </div>

          <Section title="Waiting on you" count={waiting.length}>
            {waiting.length === 0 ? (
              <Empty>Nothing needs a decision from you.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {waiting.map((t) => {
                  const owner = membersById[t.ownerId];
                  const pal = owner ? paletteFor(owner.id) : paletteFor("?");
                  const chan = channelsById[t.channelId];
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: "13px 14px", background: color.surface }}>
                      <Avatar mono={owner ? owner.mono : "?"} bg={pal.bg} fg={pal.fg} size={32} square={owner?.kind === "agent"} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{owner?.name ?? "Someone"}</span>
                          {owner?.kind === "agent" && <AgentBadge />}
                          {chan && <span style={{ fontSize: 12.5, color: color.accentText }}>#{chan.name}</span>}
                          <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>{relativeTime(t.updatedAt)}</span>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13.5, color: "#33333B", lineHeight: 1.55 }}>{t.title}</div>
                      </div>
                      <button
                        onClick={() => (t.runId ? onOpenRun(t.runId) : chan ? onOpenChannel(t.channelId) : onGoTasks())}
                        className="ws-hoverable-dark"
                        style={{ flex: "none", display: "flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 8, border: "none", background: color.dark, color: "#fff", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
                      >
                        {t.status === "needs_approval" ? "Review" : "Open"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Overnight from your agents">
            {agentActivity.length === 0 ? (
              <Empty>No recent agent activity.</Empty>
            ) : (
              <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
                {agentActivity.map((m, i) => {
                  const a = m.authorId ? membersById[m.authorId] : undefined;
                  const pal = a ? paletteFor(a.id) : paletteFor("?");
                  return (
                    <button
                      key={m.id}
                      onClick={() => onOpenChannel(m.channelId)}
                      className="ws-hoverable"
                      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "11px 14px", borderTop: i ? `1px solid ${color.borderLight}` : "none", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                    >
                      <Avatar mono={a ? a.mono : "?"} bg={pal.bg} fg={pal.fg} size={22} square />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#33333B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.text}</span>
                      <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight, flex: "none" }}>{relativeTime(m.createdAt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {jumpChannels.length > 0 && (
            <Section title="Jump back in">
              <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {jumpChannels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onOpenChannel(c.id)}
                    className="ws-hoverable"
                    style={{ textAlign: "left", border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: "12px 13px", cursor: "pointer", background: color.surface }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>#{c.name}</div>
                    <div style={{ marginTop: 5, fontSize: 12.5, color: color.muted, lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {lastLineFor(c.id) || c.topic || "No messages yet"}
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        {count ? (
          <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 10, background: color.accent, color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{count}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: color.mutedLight, padding: "2px 0" }}>{children}</div>;
}

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

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
