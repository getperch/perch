import type { Channel, Member, Procedure } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { Pill } from "../primitives/Pill.js";
import { MenuIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor } from "../utils.js";

const lastRunPill: Record<"completed" | "failed", { bg: string; fg: string; label: string }> = {
  completed: { bg: color.statusDoneBg, fg: color.statusDoneFg, label: "Last run OK" },
  failed: { bg: color.statusDeclinedBg, fg: color.statusDeclinedFg, label: "Last run failed" },
};

function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RoutinesScreen({
  procedures,
  membersById,
  channelsById,
  onOpen,
  onTeach,
  isNarrow,
  onOpenSidebar,
}: {
  procedures: Procedure[];
  members: Member[];
  membersById: Record<string, Member>;
  channelsById: Record<string, Channel>;
  onOpen: (id: string) => void;
  onTeach: () => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
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
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Routines</h1>
        {!isNarrow && (
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.muted, borderLeft: `1px solid ${color.border}`, paddingLeft: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            A browser workflow you teach once — an agent replays the exact steps on a schedule.
          </span>
        )}
        {isNarrow && <span style={{ flex: 1 }} />}
        <Button variant="primary" onClick={onTeach}>+ Teach a new routine</Button>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
          {procedures.map((p) => {
            const agent = membersById[p.agentId];
            const pal = paletteFor(p.agentId);
            const lr = p.lastRun ? lastRunPill[p.lastRun.status] : undefined;
            const channel = p.schedule ? channelsById[p.schedule.channelId] : undefined;
            return (
              <button
                key={p.id}
                onClick={() => onOpen(p.id)}
                className="ws-hoverable"
                style={{ display: "block", width: "100%", textAlign: "left", padding: "16px 20px", borderBottom: `1px solid ${color.border}`, background: color.surface, border: "none", cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <Avatar mono={agent?.mono ?? "?"} bg={pal.bg} fg={pal.fg} square />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{p.name}</span>
                      <span style={{ font: `500 10px ${font.mono}`, color: color.mutedDark, background: color.bg, borderRadius: 6, padding: "2px 6px" }}>
                        {p.steps.length} {p.steps.length === 1 ? "step" : "steps"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: color.muted }}>{agent?.name ?? "no agent"}</span>
                      <Dot />
                      <span style={{ fontSize: 12, color: color.muted }}>
                        {p.schedule ? `${p.schedule.cron} → ${channel ? `#${channel.name}` : "a channel"}` : "no schedule"}
                      </span>
                      {p.lastRun && (
                        <>
                          <Dot />
                          <span style={{ fontSize: 12, color: color.muted }}>ran {relativeTime(p.lastRun.at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {lr && <Pill bg={lr.bg} fg={lr.fg}>{lr.label}</Pill>}
                </div>
              </button>
            );
          })}
          {procedures.length === 0 && (
            <div style={{ textAlign: "center", padding: 48, color: color.muted, fontSize: 14 }}>
              No routines yet. Teach one to hand a repetitive browser chore to an agent.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span style={{ width: 3, height: 3, borderRadius: radius.pill, background: color.borderStrong }} />;
}
