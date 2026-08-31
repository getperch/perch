import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentMember, Channel, Member, ProcedureSchedule, ProcedureStep } from "@perch/core";
import { Button } from "../primitives/Button.js";
import { Card, SectionLabel } from "../primitives/Card.js";
import { color, font, radius } from "../tokens.js";

export type RecorderSaveInput = {
  name: string;
  agentId: string;
  channelId: string;
  startUrl: string;
  steps: ProcedureStep[];
  schedule?: ProcedureSchedule;
  /** plaintext values for the `valueRef: "secret:<key>"` steps — stored after the routine exists */
  secrets: { key: string; value: string }[];
};

const STEP_KINDS: ProcedureStep["kind"][] = ["goto", "waitFor", "click", "fill", "select", "extract", "assert", "humanCheckpoint"];

export function RoutineRecorderScreen({
  recording,
  liveView,
  polledSteps,
  recordingStatus,
  starting,
  stopping,
  saving,
  error,
  members,
  channels,
  onStart,
  onStop,
  onSave,
  onCancel,
}: {
  recording?: { recordingId: string };
  /** the live-view surface, supplied by the host app (Amazon DCV web client — see App.tsx) */
  liveView?: ReactNode;
  polledSteps: ProcedureStep[];
  recordingStatus?: "recording" | "complete" | "error";
  starting?: boolean;
  stopping?: boolean;
  saving?: boolean;
  error?: string;
  members: Member[];
  channels: Channel[];
  onStart: (startUrl: string) => void;
  onStop: () => void;
  onSave: (input: RecorderSaveInput) => void;
  onCancel: () => void;
}) {
  const agents = useMemo(() => members.filter((m): m is AgentMember => m.kind === "agent"), [members]);
  const [startUrl, setStartUrl] = useState("https://");
  const phase: "url" | "recording" | "review" = !recording ? "url" : recordingStatus === "complete" || recordingStatus === "error" ? "review" : "recording";

  // Editable working copy of the steps, seeded once we enter review.
  const [steps, setSteps] = useState<ProcedureStep[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (phase === "review" && !seeded) {
      setSteps(polledSteps);
      setSeeded(true);
    }
  }, [phase, seeded, polledSteps]);

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState("UTC");

  function patchStep(i: number, patch: Partial<ProcedureStep>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }
  function move(i: number, dir: -1 | 1) {
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = s.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  function remove(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }
  function addStep(kind: ProcedureStep["kind"]) {
    setSteps((s) => [...s, { id: `new-${Date.now()}`, kind, selectors: [], label: kind }]);
  }
  function markSecret(i: number) {
    const step = steps[i];
    if (!step) return;
    const key = (step.label || "secret").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "secret";
    const value = window.prompt(`Value for secret "${key}" (stored in SSM, never shown again):`);
    if (value == null) return;
    setSecrets((m) => ({ ...m, [key]: value }));
    patchStep(i, { valueRef: `secret:${key}`, value: undefined });
  }

  function save() {
    const usedKeys = new Set(steps.map((s) => s.valueRef?.slice("secret:".length)).filter(Boolean) as string[]);
    onSave({
      name: name.trim() || "Untitled routine",
      agentId,
      channelId,
      startUrl,
      steps,
      schedule: scheduleOn && cron.trim() && channelId ? { cron: cron.trim(), timezone: timezone.trim() || "UTC", channelId } : undefined,
      secrets: Object.entries(secrets).filter(([k]) => usedKeys.has(k)).map(([key, value]) => ({ key, value })),
    });
  }

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Teach a routine</h1>
        <span style={{ fontSize: 12, color: color.muted }}>
          {phase === "url" ? "Pick where to start" : phase === "recording" ? "Recording — drive the browser below" : "Review the captured steps"}
        </span>
        <span style={{ flex: 1 }} />
        {phase === "recording" && (
          <Button variant="primary" onClick={onStop}>{stopping ? "Stopping…" : "Done recording"}</Button>
        )}
        {phase === "review" && (
          <Button variant="primary" onClick={save}>{saving ? "Saving…" : "Save routine"}</Button>
        )}
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <Card style={{ border: `1px solid ${color.statusDeclinedBg}`, background: color.statusDeclinedBg }}>
            <div style={{ fontSize: 13, color: color.statusDeclinedFg }}>{error}</div>
          </Card>
        )}

        {phase === "url" && (
          <Card>
            <SectionLabel>Where does this routine start?</SectionLabel>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://example.com/login"
                style={{ flex: 1, height: 38, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 12px", font: `400 14px ${font.mono}`, outline: "none" }}
              />
              <Button variant="primary" onClick={() => onStart(startUrl)}>{starting ? "Starting…" : "Start recording"}</Button>
            </div>
            <div style={{ fontSize: 12, color: color.muted, marginTop: 10, lineHeight: 1.6 }}>
              A real browser opens below. Do the task once — log in, click through, pull the value you want.
              Every action is captured as a step you can edit before saving.
            </div>
          </Card>
        )}

        {phase !== "url" && (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${color.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: phase === "recording" ? color.live : color.mutedLight }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: color.mutedDark }}>
                {phase === "recording" ? "Live browser — click and type here to record" : "Session ended"}
              </span>
            </div>
            <div style={{ minHeight: 200, background: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {liveView ?? (
                <span style={{ color: color.mutedLight, fontSize: 13, textAlign: "center", padding: 24, lineHeight: 1.6 }}>
                  A browser window opened on your machine — do the workflow there. Every click and
                  field entry is captured. Close it (or press Stop) when you're done.
                </span>
              )}
            </div>
          </Card>
        )}

        {phase !== "url" && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <SectionLabel>Steps {phase === "recording" ? `(capturing — ${polledSteps.length})` : `(${steps.length})`}</SectionLabel>
              <span style={{ flex: 1 }} />
              {phase === "review" && (
                <select
                  onChange={(e) => {
                    if (e.target.value) addStep(e.target.value as ProcedureStep["kind"]);
                    e.target.value = "";
                  }}
                  defaultValue=""
                  style={{ height: 28, borderRadius: radius.md, border: `1px solid ${color.borderStrong}`, font: `500 12px ${font.sans}`, padding: "0 8px" }}
                >
                  <option value="" disabled>+ add step</option>
                  {STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(phase === "recording" ? polledSteps : steps).map((s, i) => (
                <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surfaceMuted }}>
                  <span style={{ font: `600 10px ${font.mono}`, textTransform: "uppercase", color: color.accentText, background: color.accentTint, borderRadius: 5, padding: "2px 6px", marginTop: 2 }}>{s.kind}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    {phase === "review" ? (
                      <>
                        <input value={s.label ?? ""} onChange={(e) => patchStep(i, { label: e.target.value })} placeholder="label" style={rowInput} />
                        {s.kind === "goto" ? (
                          <input value={s.url ?? ""} onChange={(e) => patchStep(i, { url: e.target.value })} placeholder="https://…" style={{ ...rowInput, fontFamily: font.mono }} />
                        ) : (
                          <input
                            value={s.selectors[0] ?? ""}
                            onChange={(e) => patchStep(i, { selectors: [e.target.value, ...s.selectors.slice(1)] })}
                            placeholder="selector"
                            style={{ ...rowInput, fontFamily: font.mono }}
                          />
                        )}
                        {(s.kind === "fill" || s.kind === "select" || s.kind === "assert") && (
                          s.valueRef ? (
                            <span style={{ fontSize: 11, color: color.accentText }}>🔒 {s.valueRef}</span>
                          ) : (
                            <input value={s.value ?? ""} onChange={(e) => patchStep(i, { value: e.target.value })} placeholder="value" style={rowInput} />
                          )
                        )}
                        {s.kind === "extract" && (
                          <input value={s.extractKey ?? ""} onChange={(e) => patchStep(i, { extractKey: e.target.value })} placeholder="store as…" style={rowInput} />
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 13, color: color.ink }}>{s.label || s.kind}</span>
                        <span style={{ font: `400 11px ${font.mono}`, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.kind === "goto" ? s.url : s.selectors[0]}{s.valueRef ? "  🔒" : ""}
                        </span>
                      </>
                    )}
                  </div>
                  {phase === "review" && (
                    <div style={{ display: "flex", gap: 2, flex: "none" }}>
                      {s.kind === "fill" && !s.valueRef && <MiniBtn label="🔒" title="Mark value as secret" onClick={() => markSecret(i)} />}
                      <MiniBtn label="↑" onClick={() => move(i, -1)} />
                      <MiniBtn label="↓" onClick={() => move(i, 1)} />
                      <MiniBtn label="✕" onClick={() => remove(i)} />
                    </div>
                  )}
                </div>
              ))}
              {(phase === "recording" ? polledSteps : steps).length === 0 && (
                <div style={{ fontSize: 12, color: color.muted, padding: "8px 2px" }}>
                  {phase === "recording" ? "No steps captured yet — start interacting with the page." : "No steps."}
                </div>
              )}
            </div>
          </Card>
        )}

        {phase === "review" && (
          <Card>
            <SectionLabel>Save as</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} style={rowInput} /></Field>
              <Field label="Agent">
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={selectStyle}>
                  <option value="">Choose an agent</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Result channel">
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={selectStyle}>
                  <option value="">Choose a channel</option>
                  {channels.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
                </select>
              </Field>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "16px 0 0" }}>
              <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} />
              Run on a schedule
            </label>
            {scheduleOn && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
                <Field label="Cron (5-field)"><input value={cron} onChange={(e) => setCron(e.target.value)} style={{ ...rowInput, fontFamily: font.mono }} /></Field>
                <Field label="Timezone"><input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={rowInput} /></Field>
              </div>
            )}
          </Card>
        )}
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

function MiniBtn({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="ws-hoverable"
      style={{ width: 24, height: 24, border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface, cursor: "pointer", fontSize: 11 }}
    >
      {label}
    </button>
  );
}

const rowInput: React.CSSProperties = {
  height: 30,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.md,
  padding: "0 8px",
  font: `400 12.5px ${font.sans}`,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  appearance: "none",
  width: "100%",
  height: 32,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.md,
  padding: "0 10px",
  font: `500 13px ${font.sans}`,
  color: color.ink,
  background: color.surface,
  outline: "none",
  cursor: "pointer",
};
