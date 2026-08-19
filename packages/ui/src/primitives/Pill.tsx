import type { CSSProperties, ReactNode } from "react";
import { radius } from "../tokens.js";

export function Pill({
  children,
  bg,
  fg,
  style,
}: {
  children: ReactNode;
  bg: string;
  fg: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: fg,
        background: bg,
        borderRadius: radius.pill,
        padding: "2px 8px",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
