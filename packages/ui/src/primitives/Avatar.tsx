import type { CSSProperties } from "react";
import { radius } from "../tokens.js";
import { PerchMark } from "../Brand.js";

type AvatarProps = {
  mono: string;
  bg: string;
  fg: string;
  size?: number;
  square?: boolean;
  style?: CSSProperties;
};

/**
 * Members render as an avatar: people (round) show their initials; agents (`square`) show the
 * Perch bird knocked into a rounded tile — the flock reads at a glance in any member stack.
 */
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
      {square ? <PerchMark size={size * 0.62} color={fg} /> : mono}
    </span>
  );
}
