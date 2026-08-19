import type { ReactNode } from "react";
import { MenuIcon } from "../icons.js";
import { color, radius } from "../tokens.js";

/** Placeholder body for nav destinations the backend doesn't feed yet (Threads, Canvases) — keeps
 * the sidebar item from being a dead end. */
export function EmptyScreen({
  title,
  icon,
  line,
  isNarrow,
  onOpenSidebar,
}: {
  title: string;
  icon: ReactNode;
  line: string;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: `1px solid ${color.borderLight}` }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: radius.md, cursor: "pointer" }}>
            <MenuIcon />
          </button>
        ) : null}
        <h1 style={{ margin: 0, fontSize: 15.5, fontWeight: 600 }}>{title}</h1>
      </header>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 40, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: radius.xl, background: color.surfaceMuted, border: `1px solid ${color.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: color.muted }}>
          {icon}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: color.mutedDark, maxWidth: 360, lineHeight: 1.5 }}>{line}</div>
      </div>
    </div>
  );
}
