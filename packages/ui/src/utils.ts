import type { Member } from "@fizz/core";
import { avatarPalette } from "./tokens.js";

/** Deterministic avatar color from any stable id/name, so a member's color never flickers between renders. */
export function paletteFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length]!;
}

export function monoFor(name: string) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : name.slice(0, 2);
  return initials.toUpperCase();
}

/**
 * The `@token` used both when the composer inserts a mention and when message text is scanned to
 * highlight one — agents already have a stable `handle` (also what the backend matches @mentions
 * against to route work, see services/api/src/routers/messages.ts); people don't, so this derives
 * one from their name the same way AddMemberScreen already derives an agent's handle from its
 * name, rather than persisting a new field on Person just for this.
 */
export function mentionTokenFor(member: Member): string {
  if (member.kind === "agent") return member.handle;
  return member.name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Message-body segments for lightweight inline rendering: `@mention` chips and `` `code` ``
 * spans, everything else plain. Shared by the composer echo in ChatScreen and the Mentions feed. */
export type TextSegment = { v: string; kind: "plain" | "mention" | "code" };

export function segmentText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  for (const part of text.split(/(@[A-Za-z0-9_-]+|`[^`]+`)/g)) {
    if (!part) continue;
    if (part[0] === "@") out.push({ v: part, kind: "mention" });
    else if (part[0] === "`") out.push({ v: part.slice(1, -1), kind: "code" });
    else out.push({ v: part, kind: "plain" });
  }
  return out;
}

export function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
