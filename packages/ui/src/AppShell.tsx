import { useState, type ReactNode } from "react";
import { color, responsiveBreakpointPx } from "./tokens.js";
import { useIsNarrow } from "./hooks/useIsNarrow.js";

/**
 * The app shell: a nav sidebar, the main column, and an optional right rail, all sitting flat on
 * `color.surface` — no gradient frame, no floating card. The desktop app draws its own window
 * chrome (drag region + traffic lights) as a strip above this shell; the workspace switcher and
 * the current-user menu live at the top and bottom of the `sidebar` itself.
 *
 * Below `responsiveBreakpointPx` the sidebar collapses into a drawer opened via `openSidebar`.
 */
export function AppShell({
  sidebar,
  main,
  rightRail,
  rightRailOpen,
}: {
  /** A node, or a render fn given `closeSidebar` — call it from nav handlers so the mobile drawer
   * dismisses on tap (it's a no-op when the sidebar is docked). */
  sidebar: ReactNode | ((ctx: { closeSidebar: () => void }) => ReactNode);
  main: (ctx: { isNarrow: boolean; openSidebar: () => void }) => ReactNode;
  rightRail?: ReactNode;
  rightRailOpen?: boolean;
}) {
  const isNarrow = useIsNarrow(responsiveBreakpointPx);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const renderSidebar = (closeSidebar: () => void) =>
    typeof sidebar === "function" ? sidebar({ closeSidebar }) : sidebar;

  return (
    <div
      style={{
        // `100%` (not `100vh`) so a host that renders its own chrome above the shell — e.g. the
        // desktop app's custom titlebar — gets a shell that fills the *remaining* height rather
        // than overflowing the viewport. `#root`/body/html are `height:100%` (global.css).
        height: "100%",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        background: color.surface,
        overflow: "hidden",
      }}
    >
      {/* Reserves space for the phone's status bar / camera cutout — a Tauri Android webview draws
          edge-to-edge, so without this the fixed-height header bars render underneath it. */}
      <div style={{ flex: "none", height: "env(safe-area-inset-top)" }} />

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }}>
        {!isNarrow && (
          <div style={{ width: 244, flex: "none", borderRight: `1px solid ${color.border}` }}>{renderSidebar(() => {})}</div>
        )}

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {main({ isNarrow, openSidebar: () => setMobileSidebarOpen(true) })}
        </main>

        {rightRail && !isNarrow && rightRailOpen ? <div style={{ width: 328, flex: "none" }}>{rightRail}</div> : null}

        {isNarrow && mobileSidebarOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 20, display: "flex" }} onClick={() => setMobileSidebarOpen(false)}>
            <div
              style={{ width: 264, height: "100%", paddingTop: "env(safe-area-inset-top)", background: color.surfaceMuted }}
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebar(() => setMobileSidebarOpen(false))}
            </div>
            <div style={{ flex: 1, background: "#00000040" }} />
          </div>
        )}
      </div>

      {/* Reserves space above the phone's home indicator / on-screen nav buttons, so composers and
          bottom actions in every screen aren't covered by them. */}
      <div style={{ flex: "none", height: "env(safe-area-inset-bottom)" }} />
    </div>
  );
}
