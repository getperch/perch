import type { Channel, Member } from "@perch/core";
import { Avatar } from "../primitives/Avatar.js";
import { Button } from "../primitives/Button.js";
import { Pill } from "../primitives/Pill.js";
import { MenuIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor } from "../utils.js";

const TEMPLATE_CARDS = [
  { name: "Daily digest", mono: "DD", desc: "Summarises the night, flags what needs a human." },
  { name: "Alert triage", mono: "AT", desc: "Investigates a firing alert and recommends a step." },
  { name: "Data cleanup", mono: "DC", desc: "Dedupes new datasets and reports what merged." },
];

export function PeopleScreen({
  members,
  channels,
  onAddMember,
  onOpenAgent,
  isNarrow,
  onOpenSidebar,
}: {
  members: Member[];
  channels: Channel[];
  onAddMember: () => void;
  onOpenAgent: (memberId: string) => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const channelCountFor = (m: Member) => channels.filter((c) => c.memberIds.includes(m.id)).length;
  const toolCountFor = (m: Member) => (m.kind === "agent" ? m.config.tools.length : 0);

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
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>People</h1>
        {!isNarrow && (
          <span style={{ fontSize: 12, color: color.muted, borderLeft: `1px solid ${color.border}`, paddingLeft: 12 }}>
            People and agents are members here — same list, same access model.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button variant="primary" onClick={onAddMember}>Add member</Button>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.8fr", gap: 12, padding: "12px 20px", background: color.surfaceMuted, borderBottom: `1px solid ${color.border}`, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.muted }}>
            <span>Member</span><span>Type</span><span>Access</span><span>Status</span>
          </div>
          {members.map((m) => {
            const pal = paletteFor(m.id);
            const isAgent = m.kind === "agent";
            return (
              <button
                key={m.id}
                onClick={() => onOpenAgent(m.id)}
                className="ws-hoverable"
                style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.8fr", gap: 12, alignItems: "center", padding: "12px 20px", borderBottom: `1px solid ${color.border}`, background: "none", border: "none", borderTop: "none", borderLeft: "none", borderRight: "none", cursor: "pointer", textAlign: "left", width: "100%" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} square={isAgent} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                    <span style={{ display: "block", fontSize: 12, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isAgent ? `@${m.handle} · ${m.roleDescription}` : `${m.email}`}
                    </span>
                  </span>
                </div>
                <span style={{ fontSize: 12, color: color.mutedDark }}>{isAgent ? "Agent" : "Person"}</span>
                <span style={{ fontSize: 12, color: color.mutedDark }}>
                  {isAgent ? `${channelCountFor(m)} channels · ${toolCountFor(m)} tools` : m.role}
                </span>
                <span style={{ justifySelf: "start" }}>
                  {isAgent ? (
                    <Pill bg={color.agentsBadgeBg} fg={color.agentsBadgeFg}>Running</Pill>
                  ) : (
                    <Pill bg={color.agentTagBg} fg={color.agentTagFg}>Active</Pill>
                  )}
                </span>
              </button>
            );
          })}
          {members.length === 0 && <div style={{ textAlign: "center", padding: 48, color: color.muted, fontSize: 14 }}>No members yet.</div>}
        </div>

        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: color.muted, marginBottom: 4 }}>Start from a template</div>
          <div style={{ fontSize: 12, color: color.muted, marginBottom: 12 }}>Clone one into this workspace, then edit its instructions and tools.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {TEMPLATE_CARDS.map((t) => {
              const pal = paletteFor(t.name);
              return (
                <button
                  key={t.name}
                  onClick={onAddMember}
                  className="ws-hoverable"
                  style={{ textAlign: "left", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 12, cursor: "pointer" }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: radius.md, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: pal.bg, color: pal.fg }}>{t.mono}</span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginTop: 8 }}>{t.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 2, font: `400 12px ${font.sans}` }}>{t.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
