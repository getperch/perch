import { useEffect, useState } from "react";
import { color, font, PerchWordmark, SettingsIcon, CloseIcon } from "@perch/ui";
import { beginSignIn, completeSignIn } from "./lib/auth.js";
import { loadStoredBackendConfig } from "./lib/backend-config-store.js";

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pastedUrl, setPastedUrl] = useState("");

  const startSignIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await beginSignIn();
      // The browser tab does the rest — completeSignIn() runs from the deep-link listener in
      // main.tsx once it redirects back. Leave the "waiting" state up until then.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the sign-in page");
      setBusy(false);
    }
  };

  const cancel = () => {
    setBusy(false);
    setError(undefined);
    setPastedUrl("");
  };

  const submitPastedUrl = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await completeSignIn(pastedUrl.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(true); // stay in the waiting state — the pasted URL box is still what they need
    }
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: color.appGradient,
        fontFamily: font.sans,
      }}
    >
      <div
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
        <PerchWordmark size={26} style={{ marginBottom: 2 }} />
        <div style={{ fontSize: 16, fontWeight: 500, fontFamily: font.display, letterSpacing: "-0.02em" }}>Sign in</div>
        <div style={{ fontSize: 13, color: color.muted, marginTop: -6, marginBottom: 4, lineHeight: 1.55 }}>
          Opens your browser to sign in or register. New accounts only work for emails an admin has already added
          as a member.
        </div>

        <button
          type="button"
          onClick={startSignIn}
          disabled={busy}
          style={{
            height: 38,
            background: color.dark,
            color: "#fff",
            border: "none",
            borderRadius: 11,
            fontWeight: 600,
            fontSize: 13,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Waiting for browser…" : "Sign in with browser"}
        </button>

        {busy && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: color.statusInProgressBg,
              border: `1px solid ${color.statusInProgressFg}33`,
              borderRadius: 11,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 12, color: color.statusInProgressFg, lineHeight: 1.5 }}>
              After you finish in the browser, if nothing happens here, look at your browser's address bar for a
              link starting with <code style={{ fontFamily: font.mono }}>perch://callback</code> — copy it and paste
              it below.
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPastedUrl();
              }}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <input
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                placeholder="perch://callback?code=..."
                style={{
                  height: 36,
                  border: `1px solid ${color.borderStrong}`,
                  borderRadius: 10,
                  padding: "0 12px",
                  outline: "none",
                  fontSize: 12,
                  fontFamily: font.mono,
                  background: color.surface,
                }}
              />
              <button
                type="submit"
                disabled={!pastedUrl.trim()}
                style={{
                  height: 32,
                  background: color.dark,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 600,
                  cursor: pastedUrl.trim() ? "pointer" : "default",
                  fontSize: 12,
                  opacity: pastedUrl.trim() ? 1 : 0.6,
                }}
              >
                Complete sign-in
              </button>
            </form>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: color.statusDeclinedFg }}>{error}</div>}

        {busy && (
          <button
            type="button"
            onClick={cancel}
            style={{ background: "none", border: "none", color: color.muted, fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Cancel and start over
          </button>
        )}
      </div>

      <BackendCog />
    </div>
  );
}

/** Bottom-right cog: shows which backend this client is pointed at and lets you switch to another
 * (clears the stored API URL and reloads back to the Connect screen). Used to be an inline text
 * link on the card — moved out here so the card stays about signing in. */
function BackendCog() {
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState<string>();

  useEffect(() => {
    loadStoredBackendConfig().then((c) => setApiUrl(c?.apiUrl));
  }, []);

  const changeBackend = async () => {
    const { clearBackendConfig } = await import("./lib/backend-config-store.js");
    await clearBackendConfig();
    window.location.reload();
  };

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {open && (
        <div
          style={{
            width: 300,
            background: color.surface,
            border: `1px solid ${color.border}`,
            borderRadius: 12,
            boxShadow: "0 16px 44px rgba(23,20,42,0.3)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: color.ink }}>Backend</span>
            <button
              onClick={() => setOpen(false)}
              className="ws-hoverable"
              title="Close"
              style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              <CloseIcon size={12} stroke={color.muted} />
            </button>
          </div>
          <div
            style={{
              fontSize: 11.5,
              fontFamily: font.mono,
              color: color.mutedDark,
              wordBreak: "break-all",
              lineHeight: 1.5,
              background: color.surfaceMuted,
              border: `1px solid ${color.borderLight}`,
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            {apiUrl ?? "Not configured"}
          </div>
          <button
            onClick={changeBackend}
            style={{
              height: 32,
              background: color.surface,
              color: color.ink,
              border: `1px solid ${color.borderStrong}`,
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Connect to a different backend
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Backend settings"
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.16)",
          border: "1px solid rgba(255,255,255,0.28)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          cursor: "pointer",
        }}
      >
        <SettingsIcon size={17} stroke="#fff" />
      </button>
    </div>
  );
}
