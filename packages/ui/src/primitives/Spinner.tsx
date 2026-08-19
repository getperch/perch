import { color, radius } from "../tokens.js";

/** Matches the inline spinners already used for message-sending and artifact-loading states —
 * pulled out here so full-screen loading states (initial workspace load, channel switches) use
 * the same visual instead of going blank while a query is in flight. */
export function Spinner({ size = 16, stroke = color.mutedLight }: { size?: number; stroke?: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: radius.pill,
        border: `1.5px solid ${stroke}`,
        borderTopColor: "transparent",
        animation: "ws-spin 0.6s linear infinite",
      }}
    />
  );
}

/** Full-pane loading placeholder for a screen (or the whole app) that has nothing to show yet —
 * replaces what would otherwise be a blank/gray frame while the first query round-trip is in flight. */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: "100%",
        background: color.bg,
      }}
    >
      <Spinner size={20} />
      {label ? <div style={{ fontSize: 13, color: color.mutedLight }}>{label}</div> : null}
    </div>
  );
}
