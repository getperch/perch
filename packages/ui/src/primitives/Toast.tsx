import { CloseIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";

export type Toast = { id: string; tone: "error" | "info"; message: string };

const toneStyle: Record<Toast["tone"], { background: string; color: string }> = {
  error: { background: color.statusDeclinedFg, color: "#fff" },
  info: { background: color.dark, color: "#fff" },
};

/** Fixed bottom-right stack, newest on top. Owned entirely by the parent (`toasts` state +
 * `onDismiss`) — no internal timers here; auto-dismiss is the caller's responsibility, matching
 * this codebase's controlled-component convention (see `panelOpen`/`openArtifact`). */
export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: "fixed", right: 20, bottom: 100, zIndex: 200, display: "flex", flexDirection: "column-reverse", gap: 8, maxWidth: 340 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: radius.lg,
            boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
            font: `500 13px ${font.sans}`,
            ...toneStyle[t.tone],
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            style={{ flex: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: radius.sm, cursor: "pointer", opacity: 0.85 }}
            title="Dismiss"
          >
            <CloseIcon size={9} stroke="#fff" />
          </button>
        </div>
      ))}
    </div>
  );
}
