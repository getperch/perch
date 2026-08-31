import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { color } from "@perch/ui";

const appWindow = getCurrentWindow();

/**
 * Custom window chrome. The Tauri window is created with `decorations: false`
 * (see tauri.conf.json), so it has no OS-drawn title bar — this strip restores
 * the ability to drag the window around (`data-tauri-drag-region`) and to
 * minimize / maximize / close it. Double-clicking the drag region toggles
 * maximize, which Tauri handles natively.
 *
 * The matching `core:window:*` permissions (allow-close / -minimize /
 * -toggle-maximize / -start-dragging) live in
 * `src-tauri/capabilities/default.json`.
 */
export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized);
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  return (
    <div
      data-tauri-drag-region
      style={{
        flex: "none",
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        // Same gradient as the app frame so the strip blends into it. Kept on the bar itself
        // (rather than a full-window wrapper) so screens below keep their own backgrounds.
        background: color.appGradient,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Fills the bar so the whole strip left of the buttons is a drag handle. */}
      <div data-tauri-drag-region style={{ flex: 1, alignSelf: "stretch" }} />
      <Control label="Minimize" onClick={() => void appWindow.minimize()}>
        <line x1="3" y1="8" x2="13" y2="8" />
      </Control>
      <Control
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {maximized ? (
          <>
            <rect x="3.5" y="5.5" width="7" height="7" />
            <path d="M5.5 5.5V3.5h7v7h-2" />
          </>
        ) : (
          <rect x="3.5" y="3.5" width="9" height="9" />
        )}
      </Control>
      <Control label="Close" danger onClick={() => void appWindow.close()}>
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </Control>
    </div>
  );
}

function Control({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 44,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        padding: 0,
        cursor: "pointer",
        background: hover ? (danger ? "#e5484d" : "rgba(255,255,255,0.16)") : "transparent",
        color: danger && hover ? "#fff" : "rgba(255,255,255,0.85)",
        transition: "background-color 0.1s ease, color 0.1s ease",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  );
}
