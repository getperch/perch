import { useState } from "react";
import { color, font } from "@perch/ui";
import type { BackendConfig } from "./lib/backend-config-store.js";

export function ConnectScreen({ onConnect }: { onConnect: (config: BackendConfig) => Promise<void> }) {
  const [apiUrl, setApiUrl] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { normalizeApiUrl } = await import("./lib/backend-config-store.js");
      await onConnect({ apiUrl: normalizeApiUrl(apiUrl) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that URL");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: color.appGradient,
        fontFamily: font.sans,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          width: 380,
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: 18,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 24px 60px rgba(23,20,42,0.32)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Connect to your backend</div>
        <div style={{ fontSize: 13, color: color.muted, marginTop: -6, marginBottom: 4, lineHeight: 1.55 }}>
          Enter the API URL from your <code style={{ fontFamily: font.mono }}>sst deploy</code> output.
        </div>
        <input
          type="url"
          placeholder="https://xxxxxxxxxx.execute-api.region.amazonaws.com/stage"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          style={{ height: 36, border: `1px solid ${color.borderStrong}`, borderRadius: 10, padding: "0 12px", outline: "none", fontSize: 13, fontFamily: font.mono }}
        />
        {error && <div style={{ fontSize: 12, color: color.statusDeclinedFg }}>{error}</div>}
        <button
          type="submit"
          disabled={busy || !apiUrl.trim()}
          style={{
            height: 38,
            background: color.dark,
            color: "#fff",
            border: "none",
            borderRadius: 11,
            fontWeight: 600,
            fontSize: 13,
            cursor: busy || !apiUrl.trim() ? "default" : "pointer",
            opacity: busy || !apiUrl.trim() ? 0.65 : 1,
          }}
        >
          {busy ? "Connecting…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
