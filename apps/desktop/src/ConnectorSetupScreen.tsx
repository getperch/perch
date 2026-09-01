import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { CONNECTOR_SETUP_ROUTINES } from "@perch/core";
import { api } from "./lib/api-client.js";

/**
 * Local connector setup: replays the connector's pre-authored setup routine
 * (`CONNECTOR_SETUP_ROUTINES` in @perch/core — an ordinary ProcedureStep list) in the user's own
 * browser via the Playwright sidecar. `humanCheckpoint` steps pause with an instruction; on the
 * final `extract` steps the captured values are saved to the connector config.
 */
type Ev =
  | { t: "step"; kind: string; detail: string }
  | { t: "need_human"; detail: string }
  | { t: "extract"; key: string; value: string }
  | { t: "error"; detail: string }
  | { t: "done" }
  | { t: "result" };

export function ConnectorSetupScreen({ connectorId, onDone }: { connectorId: string; onDone: (configured: boolean) => void }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const startedRef = useRef(false);
  const routine = CONNECTOR_SETUP_ROUTINES[connectorId as keyof typeof CONNECTOR_SETUP_ROUTINES];

  const browsers = useQuery({ queryKey: ["browsers"], queryFn: () => api.connectors.listBrowsers(), staleTime: Infinity, retry: false });
  const noBrowser = browsers.data && browsers.data.system.length === 0 && !browsers.data.bundled;

  const run = useMutation({
    mutationFn: async () => {
      if (!routine) throw new Error(`no local setup routine for "${connectorId}"`);
      const extracted = await api.procedures.replayLocal(routine.steps, undefined, routine.startUrl);
      const values: Record<string, string> = {};
      for (const key of routine.produces) {
        if (!extracted[key]) throw new Error(`the routine didn't capture "${key}" — finish in the browser and paste the values in`);
        values[key] = extracted[key];
      }
      await api.connectors.saveConfig(connectorId, values);
    },
    onSuccess: () => onDone(true),
  });

  useEffect(() => {
    const un = listen<Ev>("procedure:local", (e) => setEvents((prev) => [...prev, e.payload]));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (startedRef.current || browsers.isLoading || noBrowser || !routine) return;
    startedRef.current = true;
    run.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsers.isLoading, noBrowser, routine]);

  const lastHuman = [...events].reverse().find((e): e is Extract<Ev, { t: "need_human" }> => e.t === "need_human");
  const done = run.isSuccess || run.isError;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", maxWidth: 640, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Set up {connectorId === "google-workspace" ? "Google Workspace" : connectorId}</div>
      <div style={{ fontSize: 12.5, color: "#666", marginTop: 6, lineHeight: 1.6 }}>
        A browser window opens and runs the setup routine. It pauses with an instruction whenever
        you need to do a step by hand (sign-in, a wizard). When it captures the credentials it saves
        them here automatically.
      </div>

      {!routine && (
        <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #e2b8b8", background: "#fdecec", borderRadius: 8, fontSize: 13 }}>
          There's no local setup routine for this connector yet — fill the fields in yourself.
        </div>
      )}
      {noBrowser && (
        <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #e2b8b8", background: "#fdecec", borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}>
          No supported browser found. Install Google Chrome or Microsoft Edge, or fill the OAuth
          client fields yourself.
        </div>
      )}

      {lastHuman && !done && (
        <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #e8cf8a", background: "#fdf6e3", borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}>
          <strong>Your turn:</strong> {lastHuman.detail}
        </div>
      )}
      {run.isError && (
        <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #e2b8b8", background: "#fdecec", borderRadius: 8, fontSize: 13 }}>{run.error.message}</div>
      )}
      {run.isSuccess && (
        <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid #b6dcc0", background: "#eef8f1", borderRadius: 8, fontSize: 13 }}>Connected — the OAuth client is saved.</div>
      )}

      <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 16, border: "1px solid #eee", borderRadius: 8, padding: "10px 12px" }}>
        {events
          .filter((e) => e.t === "step" || e.t === "need_human" || e.t === "extract")
          .map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: "#444", padding: "3px 0", display: "flex", gap: 8 }}>
              <span style={{ color: "#999", flex: "none", minWidth: 62 }}>{e.t === "need_human" ? "you" : e.t === "extract" ? "got" : (e as { kind: string }).kind}</span>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{e.t === "extract" ? `${e.key} = ${e.value.slice(0, 40)}…` : (e as { detail: string }).detail}</span>
            </div>
          ))}
        {events.length === 0 && !noBrowser && routine && <div style={{ fontSize: 12, color: "#999" }}>starting the browser…</div>}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {run.isSuccess ? (
          <button onClick={() => onDone(true)} style={{ ...btn, background: "#1a7f37", color: "#fff", border: "none" }}>Done</button>
        ) : (
          <>
            <button onClick={() => onDone(false)} style={btn}>Finish manually</button>
            {done && <button onClick={() => onDone(false)} style={btn}>Close</button>}
          </>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 7,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#222",
  cursor: "pointer",
  fontSize: 12.5,
};
