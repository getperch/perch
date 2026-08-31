import { useEffect, useRef, useState } from "react";
import type { Channel, Person } from "@perch/core";
import { Avatar } from "./primitives/Avatar.js";
import { CheckIcon, ChevronDownIcon, PlusIcon, PlusLargeIcon } from "./icons.js";
import { color, font, radius } from "./tokens.js";
import { monoFor } from "./utils.js";

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

export type WorkspaceSummary = { id: string; name: string; mark: string; meta: string; unread?: number; active: boolean };

export function Sidebar({
  workspace,
  workspaces,
  currentUser,
  onPickWorkspace,
  onOpenPreferences,
  onSignOut,
  navItems,
  activeNavKey,
  onNav,
  channels,
  activeChannelId,
  onSelectChannel,
  onCreateChannel,
  dms,
  activeDmId,
  onOpenDm,
  onNewMessage,
  onNavigate,
}: {
  /** The current workspace — shown in the switcher chip at the top of the sidebar. */
  workspace: WorkspaceSummary;
  /** Every workspace the user belongs to (today: just the one). */
  workspaces: WorkspaceSummary[];
  /** Backs the account menu pinned to the bottom of the sidebar. */
  currentUser: Person;
  onPickWorkspace: (id: string) => void;
  onOpenPreferences: () => void;
  onSignOut: () => void;
  navItems: NavItem[];
  activeNavKey?: string;
  onNav: (key: string) => void;
  channels: (Channel & { unread?: number })[];
  activeChannelId?: string;
  onSelectChannel: (id: string) => void;
  onCreateChannel: () => void;
  dms: DmEntry[];
  activeDmId?: string;
  onOpenDm: (channelId: string) => void;
  onNewMessage: () => void;
  /** Fired after any action that changes the visible screen (nav item, channel, DM, new message,
   * create channel). The mobile shell passes its drawer-close here so the menu dismisses on tap. */
  onNavigate?: () => void;
}) {
  const nav = (key: string) => {
    onNav(key);
    onNavigate?.();
  };
  const selectChannel = (id: string) => {
    onSelectChannel(id);
    onNavigate?.();
  };
  const openDm = (id: string) => {
    onOpenDm(id);
    onNavigate?.();
  };
  const newMessage = () => {
    onNewMessage();
    onNavigate?.();
  };
  const createChannel = () => {
    onCreateChannel();
    onNavigate?.();
  };
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

  // The workspace switcher and the account menu both open a popover anchored to this <aside>.
  const [menu, setMenu] = useState<null | "workspaces" | "user">(null);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const userMenuItems = [
    { label: "Set a status", hint: "" },
    { label: "Pause notifications", hint: "" },
    { label: "Preferences", hint: "⌘,", onClick: onOpenPreferences },
    { label: `Sign out of ${workspace.name}`, hint: "", onClick: onSignOut },
  ];

  return (
    <aside
      ref={asideRef}
      style={{
        position: "relative",
        height: "100%",
        background: color.surfaceMuted,
        display: "flex",
        flexDirection: "column",
        // `visible` (not `hidden`) so the switcher / account popovers can overhang the rail edge;
        // the scrolling nav list has its own `overflow-y: auto` below.
        overflow: "visible",
      }}
    >
      <div style={{ height: 52, flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "0 8px 0 10px", borderBottom: `1px solid ${color.borderLight}` }}>
        <button
          onClick={() => setMenu((m) => (m === "workspaces" ? null : "workspaces"))}
          className="ws-hoverable"
          title="Switch workspace"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flex: 1,
            padding: "5px 6px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              flex: "none",
              borderRadius: 7,
              background: color.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {workspace.mark}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              font: `600 14px ${font.display}`,
              letterSpacing: "-0.01em",
              color: color.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {workspace.name}
          </span>
          <ChevronDownIcon size={12} stroke={color.mutedLight} />
        </button>
        <button onClick={createChannel} className="ws-hoverable" title="Create a channel" style={iconBtn}>
          <PlusIcon size={15} stroke={color.muted} />
        </button>
      </div>

      {menu === "workspaces" && (
        <Popover style={{ top: 50, left: 8, right: 8 }}>
          <div style={sectionLabel}>Switch workspace</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                onPickWorkspace(w.id);
                setMenu(null);
              }}
              className="ws-hoverable"
              style={popRow}
            >
              <span style={{ width: 28, height: 28, borderRadius: 8, background: color.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                {w.mark}
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{w.name}</span>
                <span style={{ display: "block", fontSize: 12, color: color.mutedLight }}>{w.meta}</span>
              </span>
              {w.active && <CheckIcon size={13} stroke={color.accent} />}
            </button>
          ))}
          <div style={{ height: 1, background: color.borderLight, margin: "5px 4px" }} />
          <div style={{ ...popRow, color: color.mutedLight, cursor: "default" }} title="Multi-workspace is coming soon">
            <span style={{ width: 28, height: 28, borderRadius: 8, border: `1px dashed ${color.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PlusLargeIcon size={13} stroke={color.mutedLight} />
            </span>
            <span style={{ fontSize: 13.5 }}>Create a workspace</span>
          </div>
        </Popover>
      )}

      <div className="ws-sb" style={{ flex: 1, overflowY: "auto", padding: "10px 8px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {navItems.map((n) => {
            const active = n.key === activeNavKey;
            return (
              <button key={n.key} onClick={() => nav(n.key)} className="ws-hoverable" style={rowStyle(active)}>
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

        <SectionRow
          label="Channels"
          collapsed={collapsed.channels}
          onToggleCollapsed={() => toggleSection("channels")}
          action={<PlusIcon size={13} stroke="currentColor" />}
          actionTitle="Create a channel"
          onAction={createChannel}
        />
        {!collapsed.channels && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {channels.map((c) => {
            const active = c.id === activeChannelId;
            return (
              <button key={c.id} onClick={() => selectChannel(c.id)} className="ws-hoverable" style={rowStyle(active)}>
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
          onAction={newMessage}
        />
        {!collapsed.dms && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {dms.map((d) => {
            const active = d.id === activeDmId;
            return (
              <button key={d.id} onClick={() => openDm(d.id)} className="ws-hoverable" style={{ ...rowStyle(active), height: 32 }}>
                <Avatar mono={d.mono} bg={d.colorBg} fg={d.colorFg} size={18} square={d.kind === "agent"} />
                <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: active ? color.accentText : color.mutedDark, fontWeight: active ? 600 : 400 }}>{d.name}</span>
              </button>
            );
          })}
          {dms.length === 0 && <div style={{ fontSize: 12, color: color.mutedLight, padding: "4px 10px" }}>No conversations yet. Hit + to start one.</div>}
        </div>
        )}
      </div>

      {menu === "user" && (
        <Popover style={{ bottom: 56, left: 8, right: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 9px 10px" }}>
            <span style={{ width: 34, height: 34, borderRadius: radius.pill, background: color.avatarNeutralBg, color: color.avatarNeutralFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 600 }}>
              {monoFor(currentUser.name)}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{currentUser.name}</span>
              <span style={{ display: "block", fontSize: 12, color: color.mutedLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.email}</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 3px 6px", padding: "7px 8px", border: `1px solid ${color.border}`, borderRadius: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 5, background: color.live }} />
            <span style={{ fontSize: 12.5, color: color.mutedDark }}>Active</span>
          </div>
          <div style={{ height: 1, background: color.borderLight, margin: "5px 4px" }} />
          {userMenuItems.map((i) => (
            <button
              key={i.label}
              onClick={() => {
                i.onClick?.();
                setMenu(null);
              }}
              className="ws-hoverable"
              style={{ ...popRow, fontSize: 13.5, color: "#413D4E" }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>{i.label}</span>
              {i.hint && <span style={{ font: `400 11px ${font.mono}`, color: color.mutedLight }}>{i.hint}</span>}
            </button>
          ))}
        </Popover>
      )}

      <div style={{ flex: "none", borderTop: `1px solid ${color.borderLight}`, padding: 8 }}>
        <button
          onClick={() => setMenu((m) => (m === "user" ? null : "user"))}
          className="ws-hoverable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            padding: "7px 8px",
            borderRadius: 9,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span style={{ position: "relative", flex: "none" }}>
            <span style={{ width: 28, height: 28, borderRadius: radius.pill, background: color.avatarNeutralBg, color: color.avatarNeutralFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>
              {monoFor(currentUser.name)}
            </span>
            <span style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: 6, background: color.live, border: "2px solid #fff" }} />
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: color.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</span>
            <span style={{ display: "block", fontSize: 11.5, color: color.mutedLight }}>Active</span>
          </span>
          <ChevronDownIcon size={12} stroke={color.mutedLight} style={{ transform: "rotate(180deg)" }} />
        </button>
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

function Popover({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 60,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: radius.xl,
        boxShadow: "0 16px 34px rgba(23,20,42,0.18)",
        padding: 6,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  padding: "8px 9px 6px",
  font: `500 11.5px ${font.sans}`,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: color.mutedLight,
};

const popRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "8px 9px",
  borderRadius: 9,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

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
