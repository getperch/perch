/**
 * Design tokens for the "Collaborative workspace" redesign (Claude Design project
 * `e2c94291-1adc-421e-95e0-55e3663bf3a5`, file `Workspace.dc.html`). These are the single source
 * of truth for color/type/spacing across every screen — keep them in sync if the design changes.
 *
 * The exported shape (names on `color`, `avatarPalette`, `font`, `radius`, `space`,
 * `responsiveBreakpointPx`) is deliberately unchanged from the previous design so nothing
 * downstream needs to be touched just to re-skin — only the values moved.
 */
export const color = {
  /** Page background behind the floating app card (and the whole surface on mobile). */
  bg: "#EEEDF2",
  /** The gradient "frame" the app card floats on — desktop only. */
  appGradient: "linear-gradient(135deg, #8E7BF5 0%, #5B4BD6 34%, #3E6FB8 62%, #2FA98B 100%)",
  /** The app card and every primary panel. */
  surface: "#FFFFFF",
  /** Sidebar / muted fills / table headers. */
  surfaceMuted: "#FAFAFB",
  /** Tinted agent message bubble. */
  tint: "#FAF9FE",

  ink: "#18181B",
  muted: "#71717A",
  mutedLight: "#8A8A93",
  mutedDark: "#52525B",

  border: "#EAE8EE",
  borderLight: "#EFEDF2",
  borderStrong: "#E2DFEC",

  accent: "#6D5CE7",
  accentHover: "#5B4BD6",
  /** Accent text on a light tint (e.g. mention chip, active channel label). */
  accentText: "#4A3DBF",
  accentTint: "#EEEBFA",

  /** Near-black used by the composer's Send button. */
  dark: "#17142A",
  darkHover: "#000000",

  /** Presence / "live" / success green. */
  live: "#34C79A",

  agentsBadgeBg: "#EEEBFA",
  agentsBadgeFg: "#4A3DBF",
  /** The "AGENT" mono chip. */
  agentTagBg: "#F1EEFC",
  agentTagFg: "#6152C9",
  agentTagBorder: "#E2DCF8",

  statusDoneBg: "#EEF8F4",
  statusDoneFg: "#2C6F5E",
  statusOpenBg: "#F5F4F8",
  statusOpenFg: "#52525B",
  statusInProgressBg: "#FCF7EC",
  statusInProgressFg: "#8A6420",
  statusDeclinedBg: "#FCF3F3",
  statusDeclinedFg: "#8A4340",

  approvalBg: "#FCFBFE",
  approvalBorder: "#E4E0F0",
  approvalFg: "#4A3DBF",

  /** Avatar palettes — first four are the design's agent (square) colors, then person colors. */
  avatarIndigoBg: "#6D5CE7",
  avatarIndigoFg: "#FFFFFF",
  avatarDeepBg: "#0E9F8E",
  avatarDeepFg: "#FFFFFF",
  avatarInkBg: "#E05252",
  avatarInkFg: "#FFFFFF",
  avatarGreenBg: "#B4732F",
  avatarGreenFg: "#FFFFFF",
  avatarNeutralBg: "#E9A23B",
  avatarNeutralFg: "rgba(0,0,0,0.6)",
} as const;

export const avatarPalette = [
  { bg: color.avatarIndigoBg, fg: color.avatarIndigoFg },
  { bg: color.avatarDeepBg, fg: color.avatarDeepFg },
  { bg: color.avatarInkBg, fg: color.avatarInkFg },
  { bg: color.avatarGreenBg, fg: color.avatarGreenFg },
] as const;

/** Softer palette for people (round) avatars. */
export const personPalette = [
  { bg: "#E9A23B", fg: "rgba(0,0,0,0.6)" },
  { bg: "#A8C7E8", fg: "rgba(0,0,0,0.55)" },
  { bg: "#C9B8E8", fg: "rgba(0,0,0,0.55)" },
  { bg: "#D6D6CD", fg: "#3A3A34" },
] as const;

export const font = {
  sans: "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
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
