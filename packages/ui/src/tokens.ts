/**
 * Design tokens for the **Perch** brand identity (Claude Design project
 * `e2c94291-1adc-421e-95e0-55e3663bf3a5`, file `Perch Identity.dc.html`). These are the single
 * source of truth for color/type/spacing across every screen — keep them in sync if the design
 * changes.
 *
 * Palette: Iris (primary), Feather (warmth), Lagoon (motion / live), Slate (text + dark surfaces),
 * Down (app background). The exported shape (names on `color`, `avatarPalette`, `font`, `radius`,
 * `space`, `responsiveBreakpointPx`) is deliberately unchanged so nothing downstream needs touching
 * just to re-skin — only the values moved. `font.display` (Space Grotesk) is the one addition,
 * opted into by the wordmark and screen headings.
 */
export const color = {
  /** Page background behind the floating app card (and the whole surface on mobile) — "Down". */
  bg: "#F7F5FA",
  /** The gradient "frame" the app card floats on — desktop only. Iris → Slate. */
  appGradient: "linear-gradient(135deg, #9A5CF0 0%, #7D35EB 40%, #5C27BE 70%, #413D4E 100%)",
  /** The app card and every primary panel. */
  surface: "#FFFFFF",
  /** Sidebar / muted fills / table headers. */
  surfaceMuted: "#FCFBFD",
  /** Tinted agent message bubble — faint Iris wash. */
  tint: "#F6F2FD",

  ink: "#413D4E",
  muted: "#77778A",
  mutedLight: "#8A8A99",
  mutedDark: "#4A4A58",

  border: "#E4E1EC",
  borderLight: "#EEEBF5",
  borderStrong: "#D9D3E8",

  accent: "#7D35EB",
  accentHover: "#5C27BE",
  /** Accent text on a light tint (e.g. mention chip, active channel label). */
  accentText: "#6A31CC",
  accentTint: "#EFE9FC",

  /** Dark surface used by the composer's Send button — "Slate". */
  dark: "#413D4E",
  darkHover: "#2E2A38",

  /** Presence / "live" / "in flight" — "Lagoon". */
  live: "#5DE3D0",

  agentsBadgeBg: "#EFE9FC",
  agentsBadgeFg: "#6A31CC",
  /** The "AGENT" mono chip. */
  agentTagBg: "#EFE9FC",
  agentTagFg: "#6A31CC",
  agentTagBorder: "#E2D8F8",

  statusDoneBg: "#E9F9F5",
  statusDoneFg: "#2C6F5E",
  statusOpenBg: "#F1EFF5",
  statusOpenFg: "#4A4A58",
  statusInProgressBg: "#FCF3E9",
  statusInProgressFg: "#8A6420",
  statusDeclinedBg: "#FBF1F1",
  statusDeclinedFg: "#8A4340",

  approvalBg: "#FCFBFE",
  approvalBorder: "#E4E1EC",
  approvalFg: "#6A31CC",

  /** Avatar palettes — first four are the design's agent (square) colors, then person colors.
   *  Drawn from the mark: Iris wing, Lagoon tail, Feather body, Slate beak. */
  avatarIndigoBg: "#7D35EB",
  avatarIndigoFg: "#FFFFFF",
  avatarDeepBg: "#2FB6A6",
  avatarDeepFg: "#FFFFFF",
  avatarInkBg: "#413D4E",
  avatarInkFg: "#FFFFFF",
  avatarGreenBg: "#D98E52",
  avatarGreenFg: "#FFFFFF",
  avatarNeutralBg: "#F3BE93",
  avatarNeutralFg: "rgba(0,0,0,0.62)",
} as const;

export const avatarPalette = [
  { bg: color.avatarIndigoBg, fg: color.avatarIndigoFg },
  { bg: color.avatarDeepBg, fg: color.avatarDeepFg },
  { bg: color.avatarInkBg, fg: color.avatarInkFg },
  { bg: color.avatarGreenBg, fg: color.avatarGreenFg },
] as const;

/** Softer palette for people (round) avatars. */
export const personPalette = [
  { bg: "#F3BE93", fg: "rgba(0,0,0,0.62)" },
  { bg: "#C9BDEB", fg: "rgba(0,0,0,0.55)" },
  { bg: "#9FE3D8", fg: "rgba(0,0,0,0.55)" },
  { bg: "#D8D4E2", fg: "#3A3A44" },
] as const;

export const font = {
  /** Display + wordmark — "anything that speaks". */
  display: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  /** UI + body — "anything that works". */
  sans: "'Geist', ui-sans-serif, system-ui, sans-serif",
  /** ids, spend, logs. */
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

export const radius = {
  sm: 5,
  md: 8,
  lg: 11,
  xl: 13,
  pill: 9999,
} as const;

export const space = (n: number) => `${n}px`;

/** Below this window width, the sidebar and right rail collapse behind toggles instead of being pinned. */
export const responsiveBreakpointPx = 768;
