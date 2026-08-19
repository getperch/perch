import { useState, type ReactNode } from "react";
import { color, radius, responsiveBreakpointPx } from "./tokens.js";
import { useIsNarrow } from "./hooks/useIsNarrow.js";

/**
 * Four-zone shell from the "Collaborative workspace" redesign: a far-left workspace rail, then a
 * floating white app card holding nav sidebar / main / optional right rail, all sitting on a
 * gradient frame. Below `responsiveBreakpointPx` the gradient/frame drop, the card fills the
 * screen, and both the workspace rail and sidebar collapse into one drawer behind a toggle.
 */
export function AppShell({
  workspaceRail,
  sidebar,
  main,
  rightRail,
  rightRailOpen,
}: {
  workspaceRail: ReactNode;
  sidebar: ReactNode;
  main: (ctx: { isNarrow: boolean; openSidebar: () => void }) => ReactNode;
  rightRail?: ReactNode;
  rightRailOpen?: boolean;
}) {
  const isNarrow = useIsNarrow(responsiveBreakpointPx);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const card = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        overflow: "hidden",
        background: color.surface,
        borderRadius: isNarrow ? 0 : radius.xl,
        boxShadow: isNarrow ? "none" : "0 16px 36px rgba(23,20,42,0.20)",
      }}
    >
      {!isNarrow && <div style={{ width: 244, flex: "none" }}>{sidebar}</div>}

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {main({ isNarrow, openSidebar: () => setMobileSidebarOpen(true) })}
      </main>

      {rightRail && !isNarrow && rightRailOpen ? <div style={{ width: 328, flex: "none" }}>{rightRail}</div> : null}
    </div>
  );

  return (
    <div
      style={{
        height: "100vh",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: isNarrow ? color.surface : color.bg,
        overflow: "hidden",
      }}
    >
      {/* Reserves space for the phone's status bar / camera cutout — a Tauri Android webview draws
          edge-to-edge, so without this the fixed-height header bars render underneath it. */}
      <div style={{ flex: "none", height: "env(safe-area-inset-top)", background: color.surface }} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          overflow: "hidden",
          padding: isNarrow ? 0 : 11,
          background: isNarrow ? "transparent" : color.appGradient,
        }}
      >
        {isNarrow ? (
          <>
            {card}
            {mobileSidebarOpen && (
              <div style={{ position: "fixed", inset: 0, zIndex: 20, display: "flex" }} onClick={() => setMobileSidebarOpen(false)}>
                <div
                  style={{ display: "flex", height: "100%", paddingTop: "env(safe-area-inset-top)", background: color.surfaceMuted }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ flex: "none", background: color.appGradient }}>{workspaceRail}</div>
                  <div style={{ width: 244 }}>{sidebar}</div>
                </div>
                <div style={{ flex: 1, background: "#00000040" }} />
              </div>
            )}
          </>
        ) : (
          <>
            {workspaceRail}
            {card}
          </>
        )}
      </div>

      {/* Reserves space above the phone's home indicator / on-screen nav buttons, so composers and
          bottom actions in every screen aren't covered by them. */}
      <div style={{ flex: "none", height: "env(safe-area-inset-bottom)", background: color.bg }} />
    </div>
  );
}
