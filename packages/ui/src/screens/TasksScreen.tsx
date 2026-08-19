import { useMemo, useState } from "react";
import type { AgentMember, Channel, Member, Task, TaskSource, TriggerConfig } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { Pill } from "../primitives/Pill.js";
import { MenuIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor } from "../utils.js";

const statusPill: Record<Task["status"], { bg: string; fg: string; label: string }> = {
  open: { bg: color.statusOpenBg, fg: color.statusOpenFg, label: "Open" },
  in_progress: { bg: color.statusInProgressBg, fg: color.statusInProgressFg, label: "In progress" },
  needs_approval: { bg: color.approvalBg, fg: color.approvalFg, label: "Needs approval" },
  done: { bg: color.statusDoneBg, fg: color.statusDoneFg, label: "Done" },
  declined: { bg: color.statusDeclinedBg, fg: color.statusDeclinedFg, label: "Declined" },
};

const CADENCES: { id: string; name: string; cron: string }[] = [
  { id: "weekday", name: "Every weekday", cron: "0 {h} * * 1-5" },
  { id: "daily", name: "Every day", cron: "0 {h} * * *" },
  { id: "weekly", name: "Every Monday", cron: "0 {h} * * 1" },
  { id: "monthly", name: "First of the month", cron: "0 {h} 1 * *" },
];

function cadenceLabel(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  const [min, hour, , , dow] = parts;
  const time = hour && min ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : "";
  if (dow === "1-5") return `weekdays ${time}`;
  if (dow === "1") return `weekly ${time}`;
  if (parts[2] === "1") return `monthly ${time}`;
  return `daily ${time}`;
}

function cronFor(cadenceId: string, time: string): string {
  const [h, m] = time.split(":");
  const cad = CADENCES.find((c) => c.id === cadenceId) ?? CADENCES[1]!;
  return cad.cron.replace("{h}", h ?? "0").replace("0 {h}", `${m ?? "0"} ${h ?? "0"}`);
}

type ScheduleRow = { agentId: string; agent: AgentMember; index: number; trigger: TriggerConfig };

export function TasksScreen({
  tasks,
  members,
  membersById,
  currentUserId,
  channelsById,
  onOpenRun,
  onToggleDone,
  onCreateTask,
  onApproveTask,
  onDenyTask,
  onUpdateAgentTriggers,
  isNarrow,
  onOpenSidebar,
}: {
  tasks: Task[];
  members: Member[];
  membersById: Record<string, Member>;
  currentUserId: string;
  channelsById: Record<string, Channel>;
  onOpenRun: (runId: string) => void;
  onToggleDone: (taskId: string, done: boolean) => void;
  onCreateTask: (input: { title: string; ownerId?: string; source?: TaskSource; scheduleLabel?: string; detail?: string }) => void;
  onApproveTask: (task: Task) => void;
  onDenyTask: (task: Task) => void;
  onUpdateAgentTriggers: (agentId: string, triggers: TriggerConfig[]) => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const [tab, setTab] = useState<"tasks" | "schedules">("tasks");
  const [filter, setFilter] = useState<"All" | "Mine" | "Agents" | "Blocked">("All");
  const [composing, setComposing] = useState(false);
  const [schedText, setSchedText] = useState("");
  const [schedCadence, setSchedCadence] = useState("weekday");
  const [schedTime, setSchedTime] = useState("08:00");
  const [schedOwner, setSchedOwner] = useState<string>("");

  const agents = useMemo(() => members.filter((m): m is AgentMember => m.kind === "agent"), [members]);

  const schedules: ScheduleRow[] = useMemo(
    () =>
      agents.flatMap((agent) =>
        agent.config.triggers
          .map((trigger, index) => ({ agent, agentId: agent.id, index, trigger }))
          .filter((row) => row.trigger.kind === "schedule"),
      ),
    [agents],
  );

  const filtered = tasks.filter((t) => {
    if (filter === "Mine") return t.ownerId === currentUserId;
    if (filter === "Agents") return membersById[t.ownerId]?.kind === "agent";
    if (filter === "Blocked") return t.status === "needs_approval";
    return true;
  });

  const stats = [
    { label: "Open", value: tasks.filter((t) => t.status === "open").length, sub: "not started" },
    { label: "In progress", value: tasks.filter((t) => t.status === "in_progress").length, sub: "agents working" },
    { label: "Blocked", value: tasks.filter((t) => t.status === "needs_approval").length, sub: "need a decision" },
    { label: "Done", value: tasks.filter((t) => t.status === "done").length, sub: "closed" },
  ];

  const segStyle = (on: boolean): React.CSSProperties => ({
    flex: "none",
    whiteSpace: "nowrap",
    height: 24,
    padding: "0 12px",
    border: "none",
    borderRadius: radius.md,
    font: `600 12px ${font.sans}`,
    cursor: "pointer",
    background: on ? color.surface : "transparent",
    color: on ? color.ink : color.mutedDark,
    boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
  });

  function submitSchedule() {
    if (!schedOwner || !schedText.trim()) return;
    const agent = agents.find((a) => a.id === schedOwner);
    if (!agent) return;
    const cron = cronFor(schedCadence, schedTime);
    const trigger: TriggerConfig = { kind: "schedule", enabled: true, schedule: cron, label: schedText.trim().slice(0, 60), prompt: schedText.trim() };
    onUpdateAgentTriggers(agent.id, [...agent.config.triggers, trigger]);
    setComposing(false);
    setSchedText("");
  }

  function toggleSchedule(row: ScheduleRow) {
    const next = row.agent.config.triggers.map((t, i) => (i === row.index ? { ...t, enabled: !t.enabled } : t));
    onUpdateAgentTriggers(row.agentId, next);
  }

  function runScheduleNow(row: ScheduleRow) {
    onCreateTask({
      title: row.trigger.label || "Scheduled task",
      ownerId: row.agentId,
      source: "schedule",
      scheduleLabel: cadenceLabel(row.trigger.schedule ?? ""),
      detail: row.trigger.prompt,
    });
  }

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        {isNarrow ? (
          <button
            onClick={onOpenSidebar}
            className="ws-hoverable"
            style={{ width: 32, height: 32, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: radius.md, cursor: "pointer" }}
          >
            <MenuIcon />
          </button>
        ) : null}
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Tasks</h1>
        <div style={{ display: "flex", gap: 2, padding: 2, background: color.bg, borderRadius: radius.lg, marginLeft: 4 }}>
          <button onClick={() => setTab("tasks")} style={segStyle(tab === "tasks")}>One-off</button>
          <button onClick={() => setTab("schedules")} style={segStyle(tab === "schedules")}>Schedules</button>
        </div>
        {!isNarrow && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.muted, borderLeft: `1px solid ${color.border}`, paddingLeft: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {tab === "tasks" ? "Work an agent or a person owns. Agents open tasks as they go." : "Standing instructions that open a task every time they fire."}
          </span>
        )}
        {isNarrow && <span style={{ flex: 1 }} />}
        {tab === "tasks" && !isNarrow && (
          <div style={{ display: "flex", gap: 2, padding: 2, background: color.bg, borderRadius: radius.lg }}>
            {(["All", "Mine", "Agents", "Blocked"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={segStyle(filter === f)}>{f}</button>
            ))}
          </div>
        )}
        <Button
          variant="primary"
          onClick={() => (tab === "tasks" ? onCreateTask({ title: "Untitled task", ownerId: currentUserId }) : setComposing(true))}
        >
          + {tab === "tasks" ? "New task" : "New schedule"}
        </Button>
      </header>

      {tab === "schedules" ? (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
          {composing && (
            <div style={{ background: color.surface, border: `1px solid ${color.ink}`, borderRadius: radius.lg, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.muted }}>New schedule</span>
                <span style={{ flex: 1 }} />
                <Button variant="secondary" onClick={() => setComposing(false)}>Cancel</Button>
                <Button variant="primary" onClick={submitSchedule}>Create schedule</Button>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>What should happen, every time</span>
                <input
                  value={schedText}
                  onChange={(e) => setSchedText(e.target.value)}
                  placeholder="List my top 5 priorities for today"
                  style={{ height: 36, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 12px", font: `400 14px ${font.sans}`, outline: "none" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Repeats</span>
                  <select value={schedCadence} onChange={(e) => setSchedCadence(e.target.value)} style={selectStyle}>
                    {CADENCES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>At</span>
                  <input
                    value={schedTime}
                    onChange={(e) => setSchedTime(e.target.value)}
                    style={{ height: 36, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 12px", font: `400 14px ${font.mono}`, outline: "none" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Owner</span>
                  <select value={schedOwner} onChange={(e) => setSchedOwner(e.target.value)} style={selectStyle}>
                    <option value="">Choose an agent</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
            {schedules.map((row) => {
              const pal = paletteFor(row.agentId);
              return (
                <div key={`${row.agentId}-${row.index}`} style={{ padding: "16px 20px", borderBottom: `1px solid ${color.border}`, background: row.trigger.enabled ? color.surface : color.surfaceMuted }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                    <Avatar mono={row.agent.mono} bg={pal.bg} fg={pal.fg} square style={{ opacity: row.trigger.enabled ? 1 : 0.5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: row.trigger.enabled ? color.ink : color.mutedLight }}>
                          {row.trigger.label || "Schedule"}
                        </span>
                        <span style={{ font: `500 10px ${font.mono}`, color: color.mutedDark, background: color.bg, borderRadius: 6, padding: "2px 6px" }}>
                          {cadenceLabel(row.trigger.schedule ?? "")}
                        </span>
                      </div>
                      {row.trigger.prompt && <div style={{ fontSize: 12, color: color.mutedDark, lineHeight: 1.5, marginTop: 4 }}>{row.trigger.prompt}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: color.muted }}>{row.agent.name}</span>
                        <Dot />
                        <span style={{ fontSize: 12, color: color.muted }}>
                          Posts to {firstChannelOf(row.agent, channelsById)?.name ? `#${firstChannelOf(row.agent, channelsById)!.name}` : "its channel"}
                        </span>
                        <Dot />
                        <span style={{ fontSize: 12, fontWeight: 600, color: row.trigger.enabled ? color.accentText : color.mutedLight }}>
                          {row.trigger.enabled ? "Active" : "Paused"}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
                      <Button variant="secondary" onClick={() => runScheduleNow(row)}>Run now</Button>
                      <Switch on={row.trigger.enabled} onClick={() => toggleSchedule(row)} />
                    </div>
                  </div>
                </div>
              );
            })}
            {schedules.length === 0 && <div style={{ textAlign: "center", padding: 48, color: color.muted, fontSize: 14 }}>No schedules yet.</div>}
          </div>

          <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.6 }}>
            A schedule is a standing instruction on an agent's triggers. Every time it fires, its
            owner opens a real task here — so a recurring item and a one-off both end up in the
            same list.
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {stats.map((s) => (
              <div key={s.label} style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.muted, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.value}</div>
                <div style={{ fontSize: 12, color: color.muted, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
            {filtered.map((t) => {
              const owner = membersById[t.ownerId];
              const openedBy = t.openedById ? membersById[t.openedById] : undefined;
              const pal = owner ? paletteFor(owner.id) : paletteFor("?");
              const st = statusPill[t.status];
              const done = t.status === "done";
              return (
                <div key={t.id} style={{ padding: "16px 20px", borderBottom: `1px solid ${color.border}`, background: t.status === "needs_approval" ? color.approvalBg : color.surface }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <button
                      onClick={() => onToggleDone(t.id, !done)}
                      style={{ width: 20, height: 20, flex: "none", marginTop: 2, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: done ? color.accent : color.surface, border: `1px solid ${done ? color.accent : color.borderStrong}` }}
                    >
                      {done && (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#FCFCFB" strokeWidth={2.4}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                      )}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button
                        onClick={() => t.runId && onOpenRun(t.runId)}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: t.runId ? "pointer" : "default" }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: done ? color.mutedLight : color.ink, textDecoration: done ? "line-through" : "none" }}>{t.title}</span>
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: color.muted }}>Opened by {openedBy?.name ?? "someone"}</span>
                        {t.dueLabel && (
                          <>
                            <Dot />
                            <span style={{ fontSize: 12, fontWeight: t.dueLabel === "Now" || t.dueLabel === "Today" ? 600 : 400, color: t.dueLabel === "Now" || t.dueLabel === "Today" ? color.statusDeclinedFg : color.muted }}>{t.dueLabel}</span>
                          </>
                        )}
                        {t.scheduleLabel && (
                          <span style={{ font: `500 10px ${font.mono}`, color: color.mutedDark, background: color.bg, borderRadius: 6, padding: "2px 6px" }}>{t.scheduleLabel}</span>
                        )}
                      </div>
                      {t.detail && <div style={{ fontSize: 12, color: color.mutedDark, lineHeight: 1.5, marginTop: 6 }}>{t.detail}</div>}
                      {t.status === "needs_approval" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                          <button onClick={() => onApproveTask(t)} style={{ height: 32, padding: "0 16px", background: color.accent, color: "#FCFCFB", border: "none", borderRadius: 6, font: `500 11px ${font.mono}`, cursor: "pointer" }}>approve</button>
                          <button onClick={() => onDenyTask(t)} style={{ height: 32, padding: "0 16px", background: color.surface, color: color.ink, border: `1px solid ${color.borderStrong}`, borderRadius: 6, font: `500 11px ${font.mono}`, cursor: "pointer" }}>decline</button>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
                      <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
                      <Avatar mono={owner ? owner.mono : "?"} bg={pal.bg} fg={pal.fg} size={24} square={owner?.kind === "agent"} />
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ textAlign: "center", padding: 48, color: color.muted, fontSize: 14 }}>No tasks yet.</div>}
          </div>

          <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.6 }}>
            Agents open a task whenever work needs a decision, a person, or more than one run.
            Approving one here is the same as approving it in the channel.
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  appearance: "none",
  width: "100%",
  height: 36,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.lg,
  padding: "0 12px",
  font: `500 14px ${font.sans}`,
  color: color.ink,
  background: color.surface,
  outline: "none",
  cursor: "pointer",
};

function Dot() {
  return <span style={{ width: 3, height: 3, borderRadius: radius.pill, background: color.borderStrong }} />;
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: 40, height: 24, flex: "none", borderRadius: radius.pill, border: "none", padding: 2, cursor: "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start", background: on ? color.accent : color.borderStrong, transition: "background .17s" }}
    >
      <span style={{ width: 20, height: 20, borderRadius: radius.pill, background: "#FCFCFB", display: "block" }} />
    </button>
  );
}

function firstChannelOf(agent: AgentMember, channelsById: Record<string, Channel>): Channel | undefined {
  const id = agent.config.postsInChannelIds[0];
  return id ? channelsById[id] : undefined;
}
