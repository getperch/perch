import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { color, FlagsProvider } from "@perch/ui";
import type { ResolvedFlags } from "@perch/core";
import { App } from "./App.js";
import { ConnectScreen } from "./ConnectScreen.js";
import { Titlebar } from "./Titlebar.js";
import { loadStoredBackendConfig, saveBackendConfig, type BackendConfig } from "./lib/backend-config-store.js";
import { resolveAppFlags } from "./lib/flags.js";
import { completeSignIn } from "./lib/auth.js";
import { setPendingPluginImport } from "./lib/pending-plugin-import.js";
import "@perch/ui/src/global.css";

/** The custom window chrome (drag region + minimize/maximize/close) only makes sense on desktop,
 * where the Tauri window is created with `decorations: false`. On iOS/Android there's no window to
 * control, so the strip just renders a stray close button under the phone's status bar. Falls back
 * to showing it if the OS plugin isn't reachable (e.g. the Vite dev server in a plain browser). */
function showsCustomTitlebar(): boolean {
  try {
    const p = platform();
    return p !== "ios" && p !== "android";
  } catch {
    return true;
  }
}

function Root() {
  // undefined = still checking disk; null = nothing stored, needs the connect screen
  const [config, setConfig] = useState<BackendConfig | null | undefined>(undefined);
  // Rounded corners only make sense as a floating desktop window — and not while it's maximized /
  // snapped edge-to-edge, where a radius would just clip content against the screen edge.
  const desktopChrome = showsCustomTitlebar();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    loadStoredBackendConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (!desktopChrome) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => void win.isMaximized().then(setMaximized)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [desktopChrome]);

  const rounded = desktopChrome && !maximized;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: color.surface,
        borderRadius: rounded ? 12 : 0,
        border: rounded ? `1px solid ${color.border}` : "none",
      }}
    >
      {desktopChrome && <Titlebar />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {config === undefined ? null : config === null ? (
          <ConnectScreen
            onConnect={async (next) => {
              await saveBackendConfig(next);
              setConfig(next);
            }}
          />
        ) : (
          <Providers config={config} />
        )}
      </div>
    </div>
  );
}

function Providers({ config }: { config: BackendConfig }) {
  const [ready, setReady] = useState(false);
  const [flags, setFlags] = useState<ResolvedFlags | null>(null);
  const queryClient = useMemo(() => new QueryClient(), []);

  useEffect(() => {
    resolveAppFlags().then(setFlags);
  }, []);

  useEffect(() => {
    setReady(true);

    // Deep links all arrive on the one `perch://` scheme; dispatch by shape:
    //   perch://plugins/import?url=<plugin.json URL>  → open Add agent → Import, prefilled
    //   perch://callback?code=…                       → this app's own sign-in (auth.rs)
    // The Google Workspace connect flow no longer uses a deep link — it runs an OAuth loopback
    // listener inside `begin_google_connect`. Sign-in errors here are swallowed: if the exchange
    // fails, the sign-in screen stays on "Waiting for browser…" — use its "paste the callback
    // URL" fallback to see the real error.
    const routeDeepLink = (raw: string) => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return;
      }
      if (url.hostname === "plugins" && url.pathname.replace(/\/+$/, "") === "/import") {
        const target = url.searchParams.get("url");
        if (target) setPendingPluginImport(target);
        return;
      }
      completeSignIn(raw).catch(() => {});
    };

    let unlisten: (() => void) | undefined;
    getCurrent().then((urls) => {
      if (urls?.[0]) routeDeepLink(urls[0]);
    });
    onOpenUrl((urls) => {
      if (urls[0]) routeDeepLink(urls[0]);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, [config]);

  if (!ready || !flags) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <FlagsProvider value={flags}>
        <App />
      </FlagsProvider>
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
