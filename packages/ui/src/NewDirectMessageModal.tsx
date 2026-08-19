import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { Member } from "@perch/core";
import { Avatar } from "./primitives/Avatar.js";
import { Button } from "./primitives/Button.js";
import { color, font, radius } from "./tokens.js";
import { mentionTokenFor, paletteFor } from "./utils.js";
import { detectMention } from "./screens/ChatScreen.js";

type MentionState = { start: number; query: string; index: number };

/** Parses `text` for `@token` substrings that match a real member's mention token — same
 * approach as `ChatScreen.tsx`'s `renderMessageText`, so the input text is the single source of
 * truth for who's being tagged rather than a parallel selection array. */
function parseMentionedIds(text: string, members: Member[]): string[] {
  const byToken = new Map(members.map((m) => [mentionTokenFor(m).toLowerCase(), m.id]));
  if (byToken.size === 0) return [];
  const ids: string[] = [];
  for (const part of text.split(/(@[\w-]+)/g)) {
    if (!part.startsWith("@")) continue;
    const id = byToken.get(part.slice(1).toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function NewDirectMessageModal({
  members,
  onStart,
  onCancel,
  onAddMember,
}: {
  /** Every other workspace member (person or agent) eligible to start a chat with — the current
   * user is expected to already be excluded by the caller. */
  members: Member[];
  onStart: (memberIds: string[]) => void;
  onCancel: () => void;
  /** Shown as a way out when there's no one to message yet — the workspace is invite-gated, so an empty list usually means no one's been added. */
  onAddMember?: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);

  // Same two-phase cursor placement as the composer's insertMention: rewrite `text` via the
  // controlled input, then once React commits the re-render, move the caret past the inserted
  // token (doing it inline would be clobbered by the input's own re-render).
  useLayoutEffect(() => {
    if (pendingCursorRef.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
      pendingCursorRef.current = null;
    }
  }, [text]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    if (!q) return members.slice(0, 6);
    return members.filter((m) => m.name.toLowerCase().includes(q) || mentionTokenFor(m).toLowerCase().includes(q)).slice(0, 6);
  }, [mention, members]);

  const mentionedIds = useMemo(() => parseMentionedIds(text, members), [text, members]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setText(value);
    const detected = detectMention(value, e.target.selectionStart ?? value.length);
    setMention(detected ? { ...detected, index: 0 } : null);
  }

  function insertMention(member: Member) {
    if (!mention) return;
    const token = mentionTokenFor(member);
    const cursor = inputRef.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${token} ${text.slice(cursor)}`;
    pendingCursorRef.current = mention.start + token.length + 2;
    setText(next);
    setMention(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (mention && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => m && { ...m, index: (m.index + 1) % candidates.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => m && { ...m, index: (m.index - 1 + candidates.length) % candidates.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(candidates[mention.index]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && mentionedIds.length > 0) onStart(mentionedIds);
  }

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "#00000059", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxHeight: "70vh", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ font: `600 15px ${font.sans}`, color: color.ink }}>New chat</div>
        {members.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 4px" }}>
            <div style={{ fontSize: 13, color: color.muted }}>No one else here yet — invite someone to start a chat with them.</div>
            {onAddMember && (
              <Button type="button" variant="secondary" onClick={onAddMember}>
                Add a person
              </Button>
            )}
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            {mention && candidates.length > 0 && (
              <div
                className="ws-sb"
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  marginBottom: 6,
                  width: "100%",
                  maxHeight: 220,
                  overflowY: "auto",
                  background: color.surface,
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.lg,
                  boxShadow: "0 8px 24px #00000026",
                  padding: 4,
                  zIndex: 10,
                }}
              >
                {candidates.map((m, i) => {
                  const pal = paletteFor(m.id);
                  return (
                    <button
                      key={m.id}
                      onMouseDown={(e) => {
                        // preventDefault keeps the input focused so the click registers before blur.
                        e.preventDefault();
                        insertMention(m);
                      }}
                      className="ws-hoverable"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        height: 32,
                        padding: "0 8px",
                        borderRadius: radius.md,
                        background: i === mention.index ? color.bg : "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={20} square={m.kind === "agent"} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                      <span style={{ flex: "none", fontSize: 11, color: color.muted, fontFamily: font.mono }}>@{mentionTokenFor(m)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              ref={inputRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              autoFocus
              placeholder="Type @ to tag people or agents…"
              style={{ width: "100%", height: 40, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 12px", font: `400 14px ${font.sans}`, color: color.ink, background: color.surface, outline: "none" }}
            />
          </div>
        )}
        {members.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: `1px solid ${color.border}` }}>
            <span style={{ fontSize: 12, color: color.muted, flex: 1 }}>
              {mentionedIds.length === 0 ? "No one tagged" : `${mentionedIds.length} tagged`}
            </span>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={mentionedIds.length === 0} onClick={() => onStart(mentionedIds)}>
              Start chat
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
