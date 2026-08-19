import { useState } from "react";
import type { Channel } from "@perch/core";
import { Avatar } from "./primitives/Avatar.js";
import { ChevronDownIcon, PlusIcon } from "./icons.js";
import { color, font, radius } from "./tokens.js";

type SectionKey = "channels" | "dms";
const COLLAPSE_KEY: Record<SectionKey, string> = {
  channels: "ws-sidebar-channels-collapsed",
  dms: "ws-sidebar-dms-collapsed",
};

function readCollapsed(key: SectionKey): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY[key]) === "1";
  } catch {
    return false;
  }
}

export type NavItem = { key: string; label: string; glyph: React.ReactNode; count?: number; accentCount?: boolean };

/** One existing direct-message conversation — `id` is the channel id, the avatar/name are the
 * other participant (or the first, on a group DM). */
export type DmEntry = { id: string; name: string; mono: string; colorBg: string; colorFg: string; kind: "agent" | "person" };

export function Sidebar({
  workspaceName,
  navItems,
  activeNavKey,
  onNav,
  onToggleWorkspaceMenu,
  channels,
  activeChannelId,
  onSelectChannel,
  onCreateChannel,
  dms,
  activeDmId,
  onOpenDm,
  onNewMessage,
}: {
  workspaceName: string;
  navItems: NavItem[];
  activeNavKey?: string;
  onNav: (key: string) => void;
  onToggleWorkspaceMenu: () => void;
  channels: (Channel & { unread?: number })[];
  activeChannelId?: string;
  onSelectChannel: (id: string) => void;
  onCreateChannel: () => void;
  dms: DmEntry[];
  activeDmId?: string;
  onOpenDm: (channelId: string) => void;
  onNewMessage: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    channels: readCollapsed("channels"),
    dms: readCollapsed("dms"),
  });
  const toggleSection = (key: SectionKey) =>
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY[key], next[key] ? "1" : "0");
      } catch {
        // no-op: private mode / storage disabled — collapse just won't persist
      }
      return next;
    });

  return (
    <aside
      style={{
        height: "100%",
        background: color.surfaceMuted,
        borderRight: `1px solid ${color.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderBottom: `1px solid ${color.borderLight}` }}>
        <button onClick={onToggleWorkspaceMenu} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workspaceName}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color.muted} strokeWidth={2} strokeLinecap="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={onCreateChannel} className="ws-hoverable" title="Create a channel" style={iconBtn}>
          <PlusIcon size={15} stroke={color.muted} />
        </button>
      </div>

      <div className="ws-sb" style={{ flex: 1, overflowY: "auto", padding: "10px 8px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {navItems.map((n) => {
            const active = n.key === activeNavKey;
            return (
              <button key={n.key} onClick={() => onNav(n.key)} className="ws-hoverable" style={rowStyle(active)}>
                <span style={{ width: 16, display: "flex", justifyContent: "center", color: active ? color.accentText : color.muted }}>{n.glyph}</span>
                <span style={{ flex: 1, textAlign: "left" }}>{n.label}</span>
                {n.count ? (
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 600,
                      background: n.accentCount ? color.accent : color.border,
                      color: n.accentCount ? "#fff" : color.mutedDark,
                    }}
                  >
                    {n.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <SectionRow label="Channels" collapsed={collapsed.channels} onToggleCollapsed={() => toggleSection("channels")} />
        {!collapsed.channels && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {channels.map((c) => {
            const active = c.id === activeChannelId;
            return (
              <button key={c.id} onClick={() => onSelectChannel(c.id)} className="ws-hoverable" style={rowStyle(active)}>
                <span style={{ width: 14, textAlign: "center", fontSize: 15, color: color.mutedLight }}>#</span>
                <span
                  style={{
                    flex: 1,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: active ? color.accentText : color.mutedDark,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {c.name}
                </span>
                {c.unread ? (
                  <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 10, background: color.border, color: color.mutedDark, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {c.unread}
                  </span>
                ) : null}
              </button>
            );
          })}
          {channels.length === 0 && <div style={{ fontSize: 12, color: color.mutedLight, padding: "4px 10px" }}>No channels yet.</div>}
        </div>
        )}

        <SectionRow
          label="Direct messages"
          collapsed={collapsed.dms}
          onToggleCollapsed={() => toggleSection("dms")}
          action={<PlusIcon size={13} stroke="currentColor" />}
          actionTitle="New message"
          onAction={onNewMessage}
        />
        {!collapsed.dms && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {dms.map((d) => {
            const active = d.id === activeDmId;
            return (
              <button key={d.id} onClick={() => onOpenDm(d.id)} className="ws-hoverable" style={{ ...rowStyle(active), height: 32 }}>
                <Avatar mono={d.mono} bg={d.colorBg} fg={d.colorFg} size={18} square={d.kind === "agent"} />
                <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: active ? color.accentText : color.mutedDark, fontWeight: active ? 600 : 400 }}>{d.name}</span>
              </button>
            );
          })}
          {dms.length === 0 && <div style={{ fontSize: 12, color: color.mutedLight, padding: "4px 10px" }}>No conversations yet. Hit + to start one.</div>}
        </div>
        )}
      </div>
    </aside>
  );
}

function SectionRow({
  label,
  action,
  actionTitle,
  onAction,
  collapsed,
  onToggleCollapsed,
}: {
  label: string;
  action?: React.ReactNode;
  actionTitle?: string;
  onAction?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 8px", marginBottom: 6 }}>
      <button
        onClick={onToggleCollapsed}
        disabled={!onToggleCollapsed}
        className={onToggleCollapsed ? "ws-hoverable" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: "2px 4px",
          margin: "0 -4px",
          borderRadius: radius.sm,
          cursor: onToggleCollapsed ? "pointer" : "default",
          font: `500 11.5px ${font.sans}`,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          color: color.mutedLight,
        }}
      >
        {onToggleCollapsed && (
          <ChevronDownIcon
            size={12}
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined, transition: "transform .12s" }}
          />
        )}
        {label}
      </button>
      <span style={{ flex: 1 }} />
      {action && (
        <button onClick={onAction} title={actionTitle} className="ws-hoverable" style={{ background: "none", border: "none", cursor: "pointer", color: color.muted, padding: 2, borderRadius: radius.sm, display: "flex" }}>
          {action}
        </button>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  borderRadius: radius.md,
  cursor: "pointer",
};

function rowStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    height: 30,
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "0 8px",
    borderRadius: 7,
    border: "none",
    background: active ? color.accentTint : "transparent",
    fontSize: 13.5,
    color: color.ink,
    cursor: "pointer",
    width: "100%",
  };
}
