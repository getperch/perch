import type { CSSProperties } from "react";
import { radius } from "../tokens.js";

type AvatarProps = {
  mono: string;
  bg: string;
  fg: string;
  size?: number;
  square?: boolean;
  style?: CSSProperties;
};

export function Avatar({ mono, bg, fg, size = 32, square = false, style }: AvatarProps) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: square ? Math.max(radius.md, Math.round(size * 0.26)) : radius.pill,
        background: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(9, size * 0.34),
        fontWeight: 700,
        ...style,
      }}
    >
      {mono}
    </span>
  );
}
