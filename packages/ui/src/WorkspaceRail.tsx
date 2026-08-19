import { useEffect, useRef, useState } from "react";
import type { Person } from "@perch/core";
import { color, font, radius } from "./tokens.js";
import { CheckIcon, ChevronDownIcon, PlusLargeIcon } from "./icons.js";
import { monoFor } from "./utils.js";

export type WorkspaceSummary = { id: string; name: string; mark: string; meta: string; unread?: number; active: boolean };

/**
 * The far-left 58px rail from the redesign: a workspace switcher at the top and the current
 * user's avatar + menu at the bottom, both opening popovers. Multi-workspace isn't modelled in
 * the backend yet, so the switcher shows the one real workspace and "Create a workspace" is a
 * disabled affordance.
 */
export function WorkspaceRail({
  workspace,
  workspaces,
  currentUser,
  onPickWorkspace,
  onOpenPreferences,
  onSignOut,
  compact,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  currentUser: Person;
  onPickWorkspace: (id: string) => void;
  onOpenPreferences: () => void;
  onSignOut: () => void;
  /** Rendered inside the mobile sidebar drawer as a slim strip — drops the popovers' fixed offset. */
  compact?: boolean;
}) {
  const [menu, setMenu] = useState<null | "workspaces" | "user">(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
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
    <div
      ref={ref}
      style={{
        position: "relative",
        width: compact ? 44 : 58,
        flex: `0 0 ${compact ? 44 : 58}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 0 8px",
        gap: 4,
      }}
    >
      <button
        onClick={() => setMenu((m) => (m === "workspaces" ? null : "workspaces"))}
        style={{
          position: "relative",
          width: 34,
          height: 34,
          borderRadius: 9,
          border: "none",
          background: color.appGradient,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 4,
          marginBottom: 12,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.16)",
        }}
      >
        {workspace.mark}
        <span
          style={{
            position: "absolute",
            bottom: -3,
            right: -3,
            width: 14,
            height: 14,
            borderRadius: 5,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronDownIcon size={9} stroke="#3A3A45" />
        </span>
      </button>

      {menu === "workspaces" && (
        <Popover style={{ top: 12, ...(compact ? { left: 48 } : { left: 66 }) }}>
          <div style={sectionLabel}>Switch workspace</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                onPickWorkspace(w.id);
                setMenu(null);
              }}
              className="ws-hoverable"
              style={rowStyle}
            >
              <span style={{ position: "relative", width: 28, height: 28, borderRadius: 8, background: color.appGradient, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
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
          <div style={{ ...rowStyle, color: color.mutedLight, cursor: "default" }} title="Multi-workspace is coming soon">
            <span style={{ width: 28, height: 28, borderRadius: 8, border: `1px dashed ${color.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PlusLargeIcon size={13} stroke={color.mutedLight} />
            </span>
            <span style={{ fontSize: 13.5 }}>Create a workspace</span>
          </div>
        </Popover>
      )}

      <span style={{ flex: 1 }} />

      {menu === "user" && (
        <Popover style={{ bottom: 12, ...(compact ? { left: 48 } : { left: 66 }) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 9px 10px" }}>
            <span style={{ width: 34, height: 34, borderRadius: radius.pill, background: color.avatarNeutralBg, color: color.avatarNeutralFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 600 }}>
              {monoFor(currentUser.name)}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{currentUser.name}</span>
              <span style={{ display: "block", fontSize: 12, color: color.mutedLight }}>{currentUser.email}</span>
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
              style={{ ...rowStyle, fontSize: 13.5, color: "#413D4E" }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>{i.label}</span>
              {i.hint && <span style={{ font: `400 11px ${font.mono}`, color: color.mutedLight }}>{i.hint}</span>}
            </button>
          ))}
        </Popover>
      )}

      <button
        onClick={() => setMenu((m) => (m === "user" ? null : "user"))}
        style={{
          position: "relative",
          width: 32,
          height: 32,
          borderRadius: radius.pill,
          border: "none",
          cursor: "pointer",
          background: color.avatarNeutralBg,
          color: color.avatarNeutralFg,
          fontSize: 11,
          fontWeight: 600,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.20)",
        }}
      >
        {monoFor(currentUser.name)}
        <span style={{ position: "absolute", bottom: -1, right: -1, width: 11, height: 11, borderRadius: 7, background: color.live, border: "2px solid rgba(255,255,255,0.92)" }} />
      </button>
    </div>
  );
}

function Popover({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        width: 262,
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

const rowStyle: React.CSSProperties = {
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
