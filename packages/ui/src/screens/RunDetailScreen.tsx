import type { Run, RunStep } from "@perch/core";
import { Button } from "../primitives/Button.js";
import { Card, SectionLabel } from "../primitives/Card.js";
import { CodeBlock } from "../primitives/CodeBlock.js";
import { Pill } from "../primitives/Pill.js";
import { color, font, radius } from "../tokens.js";

const statusPill: Record<Run["status"], { bg: string; fg: string; label: string }> = {
  queued: { bg: color.statusOpenBg, fg: color.statusOpenFg, label: "Queued" },
  running: { bg: color.statusInProgressBg, fg: color.statusInProgressFg, label: "Running" },
  waiting_approval: { bg: color.approvalBg, fg: color.approvalFg, label: "Waiting on approval" },
  completed: { bg: color.statusDoneBg, fg: color.statusDoneFg, label: "Completed" },
  failed: { bg: color.statusDeclinedBg, fg: color.statusDeclinedFg, label: "Failed" },
};

export function RunDetailScreen({
  run,
  steps,
  agentName,
  agentMono,
  agentBg,
  agentFg,
  onBack,
  onRerun,
}: {
  run: Run;
  steps: RunStep[];
  agentName: string;
  agentMono: string;
  agentBg: string;
  agentFg: string;
  onBack: () => void;
  onRerun: () => void;
}) {
  const st = statusPill[run.status];
  const stats = [
    { label: "Duration", value: durationLabel(run), sub: run.status === "completed" ? "finished" : "so far" },
    { label: "Cost", value: `$${run.costUsd.toFixed(2)}`, sub: `${run.tokensUsed.toLocaleString()} tokens` },
    { label: "Steps", value: String(steps.length), sub: `${steps.filter((s) => s.kind === "tool_call").length} tool calls` },
    { label: "Triggered by", value: run.triggeredBy, sub: agentName },
  ];

  return (
    <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: color.surfaceMuted }}>
      <header style={{ height: 56, position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", background: color.surface, borderBottom: `1px solid ${color.border}` }}>
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <span style={{ width: 24, height: 24, borderRadius: radius.md, background: agentBg, color: agentFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
          {agentMono}
        </span>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{agentName} · {run.title}</h1>
        <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
        <span style={{ font: `400 12px ${font.mono}`, color: color.muted }}>{run.id}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onRerun}>Re-run</Button>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        {run.status === "failed" && (
          <Card style={{ border: `1px solid ${color.statusDeclinedBg}`, background: color.statusDeclinedBg }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.statusDeclinedFg, marginBottom: 6 }}>
              What went wrong
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: color.statusDeclinedFg }}>
              {run.error || "No error detail was captured — check the timeline below for the last step that ran."}
            </div>
          </Card>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {stats.map((s) => (
            <Card key={s.label} style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.muted, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.value}</div>
              <div style={{ fontSize: 12, color: color.muted, marginTop: 2 }}>{s.sub}</div>
            </Card>
          ))}
        </div>

        <Card>
          <SectionLabel>Timeline</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {steps.map((s, i) => (
              <div key={s.id} style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: "none", width: 16, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: stepDotColor(s.kind) }} />
                  {i < steps.length - 1 && <span style={{ flex: 1, width: 1, background: color.border, marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: 16, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ font: `500 12px ${font.mono}`, color: color.ink }}>{s.name}</span>
                    <span style={{ fontSize: 12, color: color.mutedLight }}>{new Date(s.startedAt).toLocaleTimeString()}</span>
                    {s.durationMs != null && <span style={{ fontSize: 12, color: color.mutedLight }}>{s.durationMs}ms</span>}
                    <span style={{ flex: 1 }} />
                    {s.tokens && <span style={{ font: `400 10px ${font.mono}`, color: color.mutedLight }}>{s.tokens}</span>}
                  </div>
                  {s.detail && <div style={{ fontSize: 12, color: color.mutedDark, lineHeight: 1.5, marginTop: 4 }}>{s.detail}</div>}
                  {s.recordingUrl && (
                    <a
                      href={s.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12, fontWeight: 600, color: color.accent, textDecoration: "none" }}
                    >
                      ▶ Watch recording
                    </a>
                  )}
                  {s.code && (
                    <div style={{ marginTop: 8 }}>
                      <CodeBlock code={s.code} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function stepDotColor(kind: RunStep["kind"]) {
  if (kind === "tool_call") return color.accent;
  if (kind === "approval_wait") return color.approvalFg;
  if (kind === "trigger_wait") return color.mutedLight;
  return color.live;
}

function durationLabel(run: Run) {
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const ms = end - new Date(run.startedAt).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
