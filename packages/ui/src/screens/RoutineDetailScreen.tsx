import { useMemo, useState } from "react";
import type { AgentMember, Channel, Member, Procedure, ProcedureStep } from "@perch/core";
import { Button } from "../primitives/Button.js";
import { Card, SectionLabel } from "../primitives/Card.js";
import { Pill } from "../primitives/Pill.js";
import { color, font, radius } from "../tokens.js";

type SchedulePatch = Procedure["schedule"] | null;

export function RoutineDetailScreen({
  procedure,
  members,
  membersById,
  channels,
  onBack,
  onSave,
  onDelete,
  onRunNow,
  onRerecord,
  onSetSecret,
  onClearSecret,
  saving,
  running,
  error,
}: {
  procedure: Procedure;
  members: Member[];
  membersById: Record<string, Member>;
  channels: Channel[];
  onBack: () => void;
  onSave: (patch: { name?: string; agentId?: string; channelId?: string; steps?: ProcedureStep[]; schedule?: SchedulePatch }) => void;
  onDelete: () => void;
  onRunNow?: () => void;
  onRerecord?: () => void;
  onSetSecret?: (key: string, value: string) => void;
  onClearSecret?: (key: string) => void;
  saving?: boolean;
  running?: boolean;
  error?: string;
}) {
  const agents = useMemo(() => members.filter((m): m is AgentMember => m.kind === "agent"), [members]);

  const [name, setName] = useState(procedure.name);
  const [agentId, setAgentId] = useState(procedure.agentId);
  const [resultChannelId, setResultChannelId] = useState(procedure.channelId ?? "");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [stepsText, setStepsText] = useState(JSON.stringify(procedure.steps, null, 2));
  const [stepsError, setStepsError] = useState<string | undefined>();
  const [scheduleOn, setScheduleOn] = useState(!!procedure.schedule);
  const [cron, setCron] = useState(procedure.schedule?.cron ?? "0 9 * * 1-5");
  const [timezone, setTimezone] = useState(procedure.schedule?.timezone ?? "UTC");
  const [channelId, setChannelId] = useState(procedure.schedule?.channelId ?? channels[0]?.id ?? "");

  const agent = membersById[procedure.agentId];

  function save() {
    let steps: ProcedureStep[];
    try {
      steps = JSON.parse(stepsText);
      if (!Array.isArray(steps)) throw new Error("steps must be a JSON array");
    } catch (e) {
      setStepsError((e as Error).message);
      return;
    }
    setStepsError(undefined);
    const schedule: SchedulePatch =
      scheduleOn && cron.trim() && channelId ? { cron: cron.trim(), timezone: timezone.trim() || "UTC", channelId } : null;
    onSave({
      name: name.trim() || procedure.name,
      agentId,
      channelId: resultChannelId || undefined,
      steps,
      schedule,
    });
  }

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{procedure.name}</h1>
        {procedure.lastRun && (
          <Pill
            bg={procedure.lastRun.status === "completed" ? color.statusDoneBg : color.statusDeclinedBg}
            fg={procedure.lastRun.status === "completed" ? color.statusDoneFg : color.statusDeclinedFg}
          >
            {procedure.lastRun.status === "completed" ? "Last run OK" : "Last run failed"}
          </Pill>
        )}
        <span style={{ font: `400 12px ${font.mono}`, color: color.muted }}>{procedure.id}</span>
        <span style={{ flex: 1 }} />
        {onRerecord && <Button variant="secondary" onClick={onRerecord}>Re-record</Button>}
        {onRunNow && <Button variant="secondary" onClick={onRunNow}>{running ? "Starting…" : "Run now"}</Button>}
        <Button variant="primary" onClick={save}>{saving ? "Saving…" : "Save"}</Button>
      </header>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <Card style={{ border: `1px solid ${color.statusDeclinedBg}`, background: color.statusDeclinedBg }}>
            <div style={{ fontSize: 13, color: color.statusDeclinedFg }}>{error}</div>
          </Card>
        )}

        <Card>
          <SectionLabel>Basics</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Agent">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={selectStyle}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Start URL">
              <input value={procedure.startUrl} readOnly style={{ ...inputStyle, fontFamily: font.mono, color: color.muted, background: color.surfaceMuted }} />
            </Field>
            <Field label="Result channel (unscheduled runs)">
              <select value={resultChannelId} onChange={(e) => setResultChannelId(e.target.value)} style={selectStyle}>
                <option value="">Choose a channel</option>
                {channels.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ fontSize: 12, color: color.muted, marginTop: 10 }}>
            Owned by {membersById[procedure.ownerId]?.name ?? "someone"}. Replay runs as {agent?.name ?? "the agent"}.
          </div>
        </Card>

        <Card>
          <SectionLabel>Steps</SectionLabel>
          <div style={{ fontSize: 12, color: color.muted, marginBottom: 8, lineHeight: 1.6 }}>
            Edit the raw step array — each entry is{" "}
            {"{ id, kind, selectors, url?, value?, valueRef?, label?, extractKey? }"}. Use “Re-record”
            to capture it fresh in a live browser.
          </div>
          <textarea
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            spellCheck={false}
            style={{ width: "100%", minHeight: 260, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: 12, font: `400 12px ${font.mono}`, outline: "none", resize: "vertical", lineHeight: 1.5 }}
          />
          {stepsError && <div style={{ fontSize: 12, color: color.statusDeclinedFg, marginTop: 6 }}>Invalid JSON: {stepsError}</div>}
        </Card>

        <Card>
          <SectionLabel>Schedule</SectionLabel>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: scheduleOn ? 16 : 0 }}>
            <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
            Run this routine on a schedule
          </label>
          {scheduleOn && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <Field label="Cron (5-field)">
                <input value={cron} onChange={(e) => setCron(e.target.value)} style={{ ...inputStyle, fontFamily: font.mono }} />
              </Field>
              <Field label="Timezone">
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Post result to">
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={selectStyle}>
                  <option value="">Choose a channel</option>
                  {channels.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
                </select>
              </Field>
            </div>
          )}
          <div style={{ fontSize: 12, color: color.muted, marginTop: 12 }}>
            Fires via EventBridge Scheduler; every run also shows in Tasks as a scheduled item.
          </div>
        </Card>

        <Card>
          <SectionLabel>Secrets</SectionLabel>
          <div style={{ fontSize: 12, color: color.muted, marginBottom: 12, lineHeight: 1.6 }}>
            Values live in SSM SecureString and are never shown again. A step referencing{" "}
            <code>secret:key</code> resolves it at replay time.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {procedure.secretKeys.map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ font: `500 11px ${font.mono}`, color: color.mutedDark, background: color.bg, borderRadius: 6, padding: "4px 8px", minWidth: 120 }}>{k}</span>
                <input
                  type="password"
                  placeholder="enter to (re)set"
                  value={secretDrafts[k] ?? ""}
                  onChange={(e) => setSecretDrafts((d) => ({ ...d, [k]: e.target.value }))}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (secretDrafts[k]) {
                      onSetSecret?.(k, secretDrafts[k]!);
                      setSecretDrafts((d) => ({ ...d, [k]: "" }));
                    }
                  }}
                >
                  Save
                </Button>
                <Button variant="secondary" onClick={() => onClearSecret?.(k)}>Clear</Button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input
                placeholder="new secret key"
                value={newSecretKey}
                onChange={(e) => setNewSecretKey(e.target.value)}
                style={{ ...inputStyle, fontFamily: font.mono, minWidth: 160 }}
              />
              <input
                type="password"
                placeholder="value"
                value={secretDrafts.__new ?? ""}
                onChange={(e) => setSecretDrafts((d) => ({ ...d, __new: e.target.value }))}
                style={{ ...inputStyle, flex: 1 }}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  const key = newSecretKey.trim();
                  if (key && secretDrafts.__new) {
                    onSetSecret?.(key, secretDrafts.__new);
                    setNewSecretKey("");
                    setSecretDrafts((d) => ({ ...d, __new: "" }));
                  }
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </Card>

        <Card style={{ borderColor: color.statusDeclinedBg }}>
          <SectionLabel>Danger zone</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button variant="secondary" onClick={onDelete}>Delete routine</Button>
            <span style={{ fontSize: 12, color: color.muted }}>Also removes its stored secrets and schedule.</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      {children}
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
};

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
