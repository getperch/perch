import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { App } from "./App.js";
import { ConnectScreen } from "./ConnectScreen.js";
import { loadStoredBackendConfig, saveBackendConfig, type BackendConfig } from "./lib/backend-config-store.js";
import { completeSignIn } from "./lib/auth.js";
import { api } from "./lib/api-client.js";
import { pushToast } from "./lib/toasts.js";
import "@fizz/ui/src/global.css";

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

    // Two independent deep-link flows share the app-wide `fizz://` scheme (registered once in
    // tauri.conf.json, not path-scoped) — branch on the callback URL's host to route each to its
    // own completion command. `fizz://callback` is this app's own sign-in (auth.rs);
    // `fizz://google-workspace-callback` is a per-agent Google Workspace connect
    // (google_workspace.rs) started from AgentDetailScreen's "Connect Gmail & Calendar" button.
    const routeCallback = (url: string) => {
      if (url.startsWith("fizz://google-workspace-callback")) {
        // Errors here surface as a toast rather than being swallowed the way completeSignIn's
        // are below — there's no "paste the callback URL" fallback screen for this flow, so a
        // silent failure would just look like the Connect button did nothing.
        api.googleWorkspace
          .completeConnect(url)
          .then(() => queryClient.invalidateQueries({ queryKey: ["googleWorkspace", "connection"] }))
          .catch((err: Error) => pushToast("error", err.message || "Couldn't connect Google Workspace"));
        return;
      }
      // Errors here are swallowed: if the exchange fails, the sign-in screen just stays on
      // "Waiting for browser…" — use its "paste the callback URL" fallback to see the real error.
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
