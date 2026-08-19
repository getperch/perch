import { color, radius } from "../tokens.js";

/** The pill-track toggle from the design — used for the Mentions filter and the profile rail's
 * autonomy control. Fully controlled. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}) {
  const h = size === "sm" ? 26 : 28;
  return (
    <div style={{ display: "flex", background: "#F3F2F6", borderRadius: radius.md, padding: 3, gap: 3, ...style }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              height: h,
              padding: "0 11px",
              borderRadius: radius.sm + 1,
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: active ? 600 : 400,
              color: active ? color.ink : color.muted,
              background: active ? color.surface : "transparent",
              boxShadow: active ? "0 1px 2px rgba(23,20,42,0.09)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
