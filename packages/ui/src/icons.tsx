import type { CSSProperties } from "react";

type IconProps = { size?: number; stroke?: string; style?: CSSProperties };

export function SearchIcon({ size = 13, stroke = "#6E6E66" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.5}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14, stroke = "#6E6E66", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.5} style={style}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12, stroke = "#55554E", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.7} style={style}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function PlusIcon({ size = 13, stroke = "#6E6E66" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.6}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function CloseIcon({ size = 10, stroke = "#6E6E66" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={2}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function CheckIcon({ size = 10, stroke = "#FCFCFB" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={2.4}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export function PanelIcon({ size = 14, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.5}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
      <path d="M10 2.8v10.4" />
    </svg>
  );
}

export function CopyIcon({ size = 13, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function DocumentIcon({ size = 14, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <path d="M4 2h5.5L12 4.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M9.5 2v2.5H12" strokeLinejoin="round" />
      <path d="M5.5 8h5M5.5 10.5h5" strokeLinecap="round" />
    </svg>
  );
}

export function AlertIcon({ size = 13, stroke = "oklch(0.38 0.16 264)" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.6}>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3" />
    </svg>
  );
}

export function InboxIcon({ size = 22, stroke = "#6E6E66" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <rect x="2.5" y="3.5" width="11" height="8" rx="2.5" />
      <path d="M5.5 13.5 8 11.5" />
    </svg>
  );
}

export function SmileIcon({ size = 14, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M5.7 9.3c.5.9 1.3 1.4 2.3 1.4s1.8-.5 2.3-1.4" strokeLinecap="round" />
      <circle cx="6" cy="6.2" r="0.6" fill={stroke} stroke="none" />
      <circle cx="10" cy="6.2" r="0.6" fill={stroke} stroke="none" />
    </svg>
  );
}

export function EditIcon({ size = 13, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <path d="M10.5 2.9 13.1 5.5 5.1 13.5H2.5V10.9Z" strokeLinejoin="round" />
      <path d="M9 4.4 11.6 7" />
    </svg>
  );
}

export function TrashIcon({ size = 13, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.4}>
      <path d="M3 4.5h10M6.3 4.5V3a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v1.5" strokeLinecap="round" />
      <path d="M4.2 4.5 4.9 13a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.7-8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon({ size = 16, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.5}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />
    </svg>
  );
}

export function ThumbsUpIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <path d="M2.5 7h2.3v6.5H2.5z" strokeLinejoin="round" />
      <path d="M4.8 7l2.9-4.8c.5 0 1.2.4 1.2 1.4 0 .7-.4 1.6-.6 2.4h3.6c.7 0 1.3.6 1.2 1.3l-.8 4.4a1.3 1.3 0 0 1-1.3 1.1H4.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <path d="M8 13.2 2.6 8.1a3 3 0 0 1 4.5-3.9L8 5.1l.9-.9a3 3 0 0 1 4.5 3.9Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function LaughIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M5.3 9.5a2.9 2.9 0 0 0 5.4 0Z" strokeLinejoin="round" />
      <path d="M5.4 6.2 6.5 7M10.6 6.2 9.5 7" strokeLinecap="round" />
    </svg>
  );
}

export function PartyIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <path d="M4 12 10.5 5.5 12.5 7.5 6 14Z" strokeLinejoin="round" />
      <path d="M9.5 2.5v1.6M12.7 4v1.6M12.5 2 11.3 3.2" strokeLinecap="round" />
      <path d="M3 13.5 2.3 14.2" strokeLinecap="round" />
    </svg>
  );
}

export function EyesIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <circle cx="4.6" cy="8" r="2.6" />
      <circle cx="11.4" cy="8" r="2.6" />
      <circle cx="4.6" cy="8" r="0.5" fill={stroke} stroke="none" />
      <circle cx="11.4" cy="8" r="0.5" fill={stroke} stroke="none" />
    </svg>
  );
}

export function RocketIcon({ size = 15, stroke = "#55554E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <path d="M8 2c1.8 1.1 2.9 3.2 2.9 6 0 1.3-.3 2.4-.7 3.2H5.8c-.4-.8-.7-1.9-.7-3.2C5.1 5.2 6.2 3.1 8 2Z" strokeLinejoin="round" />
      <circle cx="8" cy="6.7" r="1" />
      <path d="M5.8 9.5 3.8 11v1.8L5.8 11.6M10.2 9.5l2 1.5v1.8l-2-1.7" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M6.6 11.2 6 14l2-1.2 2 1.2-.6-2.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── Icons added for the "Collaborative workspace" redesign ─────────────────────── */

export function ThreadsIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function HomeIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function BellIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </svg>
  );
}

export function SettingsIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.72 1.13V21a2 2 0 1 1-4 0v-.09A1.6 1.6 0 0 0 7.13 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 3 13.85a2 2 0 1 1 0-4h.09A1.6 1.6 0 0 0 4.6 7.13l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 2.87 1.04l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 21 10h.09a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 1z" />
    </svg>
  );
}

export function AtIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <path d="M4 4h16v12H7l-3 3z" />
    </svg>
  );
}

export function InviteIcon({ size = 14, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20a6 6 0 0 1 12 0M18 8v6M21 11h-6" />
    </svg>
  );
}

export function CheckSquareIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function GridIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  );
}

export function BotIcon({ size = 14, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round">
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12v2M15 12v2" />
    </svg>
  );
}

export function LockIcon({ size = 14, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function HandoffIcon({ size = 15, stroke = "#8A8A93" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

export function SlidersIcon({ size = 14, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

export function SendIcon({ size = 15, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l16-8-6 16-2.5-6.5z" />
    </svg>
  );
}

export function DotsIcon({ size = 16, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.9} strokeLinecap="round">
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

export function LinkIcon({ size = 16, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round">
      <path d="M21.4 11.1 12 20.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7" />
    </svg>
  );
}

export function PlusLargeIcon({ size = 16, stroke = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
