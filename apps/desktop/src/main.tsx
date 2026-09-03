import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { App } from "./App.js";
import { ConnectScreen } from "./ConnectScreen.js";
import { loadStoredBackendConfig, saveBackendConfig, type BackendConfig } from "./lib/backend-config-store.js";
import { completeSignIn } from "./lib/auth.js";
import "@perch/ui/src/global.css";

function Root() {
  // undefined = still checking disk; null = nothing stored, needs the connect screen
  const [config, setConfig] = useState<BackendConfig | null | undefined>(undefined);

  useEffect(() => {
    loadStoredBackendConfig().then(setConfig);
  }, []);

  if (config === undefined) return null;

  if (config === null) {
    return (
      <ConnectScreen
        onConnect={async (next) => {
          await saveBackendConfig(next);
          setConfig(next);
        }}
      />
    );
  }

  return <Providers config={config} />;
}

function Providers({ config }: { config: BackendConfig }) {
  const [ready, setReady] = useState(false);
  const queryClient = useMemo(() => new QueryClient(), []);

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

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
