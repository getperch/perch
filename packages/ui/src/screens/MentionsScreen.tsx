import { useMemo, useState } from "react";
import { Avatar } from "../primitives/Avatar.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { SegmentedControl } from "../primitives/SegmentedControl.js";
import { MenuIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { paletteFor, relativeTime, segmentText } from "../utils.js";

/** Structural mirror of `@perch/api-contract`'s `Mention` — kept local so `@perch/ui` stays
 * decoupled from the contract package (it only depends on `@perch/core`). */
export type Mention = {
  messageId: string;
  channelId: string;
  channelName: string;
  authorId?: string;
  authorKind: "person" | "agent";
  authorName: string;
  authorMono: string;
  text: string;
  createdAt: string;
  unread: boolean;
};

type Filter = "all" | "unread" | "mentions";

export function MentionsScreen({
  mentions,
  onOpenChannel,
  isNarrow,
  onOpenSidebar,
}: {
  mentions: Mention[];
  onOpenChannel: (channelId: string) => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const unread = mentions.filter((m) => m.unread).length;
  // Every row in this feed is already an @mention of the current user, so "All" and "Mentions"
  // show the same set today; "Unread" narrows to the last-24h heuristic.
  const shown = useMemo(() => (filter === "unread" ? mentions.filter((m) => m.unread) : mentions), [mentions, filter]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: `1px solid ${color.borderLight}` }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: "nowrap" }}>Notifications</span>
        {!isNarrow && (
          <>
            <span style={{ width: 1, height: 18, background: color.borderStrong }} />
            <span style={{ fontSize: 13, color: color.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{unread} unread</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread" },
            { value: "mentions", label: "Mentions" },
          ]}
        />
      </header>

      <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 0 24px" }}>
        <div style={{ maxWidth: 800, padding: "0 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((m) => {
            const pal = m.authorId ? paletteFor(m.authorId) : paletteFor(m.authorName);
            return (
              <button
                key={m.messageId}
                onClick={() => onOpenChannel(m.channelId)}
                className="ws-hoverable"
                style={{
                  display: "flex",
                  gap: 12,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.lg,
                  padding: "12px 13px",
                  cursor: "pointer",
                  background: color.surface,
                  textAlign: "left",
                }}
              >
                <Avatar mono={m.authorMono} bg={pal.bg} fg={pal.fg} size={32} square={m.authorKind === "agent"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.authorName}</span>
                    {m.authorKind === "agent" && <AgentBadge />}
                    <span style={{ fontSize: 12.5, color: color.accentText }}>#{m.channelName}</span>
                    <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>{relativeTime(m.createdAt)}</span>
                    <span style={{ flex: 1 }} />
                    {m.unread && <span style={{ width: 7, height: 7, borderRadius: 5, background: color.accent }} />}
                  </div>
                  <div style={{ fontSize: 13.5, color: "#413D4E", lineHeight: 1.55 }}>
                    {segmentText(m.text).map((p, i) =>
                      p.kind === "mention" ? (
                        <span key={i} style={{ background: color.accentTint, color: color.accentText, fontWeight: 500, padding: "1px 5px", borderRadius: 4 }}>
                          {p.v}
                        </span>
                      ) : p.kind === "code" ? (
                        <span key={i} style={{ font: `400 12.5px ${font.mono}`, background: color.surfaceMuted, border: `1px solid ${color.border}`, padding: "1px 5px", borderRadius: 4 }}>
                          {p.v}
                        </span>
                      ) : (
                        <span key={i}>{p.v}</span>
                      ),
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {shown.length === 0 && (
            <div style={{ fontSize: 13, color: color.mutedLight, padding: "24px 2px" }}>
              {mentions.length === 0 ? "No one has @mentioned you yet." : "Nothing matches this filter."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
