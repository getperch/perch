import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { FlagsProvider } from "@perch/ui";
import type { ResolvedFlags } from "@perch/core";
import { App } from "./App.js";
import { ConnectScreen } from "./ConnectScreen.js";
import { Titlebar } from "./Titlebar.js";
import { loadStoredBackendConfig, saveBackendConfig, type BackendConfig } from "./lib/backend-config-store.js";
import { resolveAppFlags } from "./lib/flags.js";
import { completeSignIn } from "./lib/auth.js";
import "@perch/ui/src/global.css";

function Root() {
  // undefined = still checking disk; null = nothing stored, needs the connect screen
  const [config, setConfig] = useState<BackendConfig | null | undefined>(undefined);

  useEffect(() => {
    loadStoredBackendConfig().then(setConfig);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Titlebar />
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

    // `perch://callback` is this app's own sign-in (auth.rs). The Google Workspace connect flow
    // no longer uses a deep link — it runs an OAuth loopback listener inside `begin_google_connect`.
    // Errors here are swallowed: if the exchange fails, the sign-in screen stays on "Waiting for
    // browser…" — use its "paste the callback URL" fallback to see the real error.
    const routeCallback = (url: string) => {
      completeSignIn(url).catch(() => {});
    };

    let unlisten: (() => void) | undefined;
    getCurrent().then((urls) => {
      if (urls?.[0]) routeCallback(urls[0]);
    });
    onOpenUrl((urls) => {
      if (urls[0]) routeCallback(urls[0]);
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
