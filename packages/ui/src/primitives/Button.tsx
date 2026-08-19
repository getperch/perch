import type { ButtonHTMLAttributes } from "react";
import { color, font, radius } from "../tokens.js";

type Variant = "primary" | "secondary" | "ghost" | "dark";

const base = {
  height: 32,
  padding: "0 14px",
  borderRadius: radius.md,
  fontFamily: font.sans,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
} as const;

const variants: Record<Variant, React.CSSProperties> = {
  primary: { ...base, background: color.accent, color: "#fff" },
  secondary: { ...base, background: color.surface, color: color.ink, border: `1px solid ${color.borderStrong}` },
  ghost: { ...base, background: "transparent", color: color.mutedDark },
  dark: { ...base, background: color.dark, color: "#fff" },
};

// primary/dark carry their hover on inline handlers (a solid color swap, not the token grey the
// `.ws-hoverable` rule applies); secondary/ghost use the shared class.
const hoverClass: Record<Variant, string> = {
  primary: "",
  secondary: "ws-hoverable",
  ghost: "ws-hoverable",
  dark: "",
};

const solidHover: Partial<Record<Variant, { on: string; off: string }>> = {
  primary: { on: color.accentHover, off: color.accent },
  dark: { on: color.darkHover, off: color.dark },
};

export function Button({
  variant = "secondary",
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const sh = solidHover[variant];
  return (
    <button
      className={[hoverClass[variant], className].filter(Boolean).join(" ")}
      style={{ ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (sh) e.currentTarget.style.background = sh.on;
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (sh) e.currentTarget.style.background = sh.off;
        onMouseLeave?.(e);
      }}
      {...rest}
    />
  );
}
