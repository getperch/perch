import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { Member } from "@fizz/core";
import { Avatar } from "../primitives/Avatar.js";
import { AgentBadge } from "../primitives/AgentBadge.js";
import { CloseIcon, MenuIcon, PlusIcon, SendIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";
import { mentionTokenFor, paletteFor } from "../utils.js";
import { detectMention } from "./ChatScreen.js";

type MentionState = { start: number; query: string; index: number };

/**
 * The "New message" compose surface — looks like an empty channel, but the header title is an
 * `@`-tag input instead of a name. Picking a recipient (Enter or click) hands the id back to the
 * parent, which opens the real 1:1 and navigates into it, so the header then shows that person.
 */
export function NewDmScreen({
  members,
  onPick,
  onCancel,
  onAddMember,
  isNarrow,
  onOpenSidebar,
}: {
  /** Everyone eligible to start a chat with — the current user is excluded by the caller. */
  members: Member[];
  onPick: (memberId: string) => void;
  onCancel: () => void;
  onAddMember: () => void;
  isNarrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (pendingCursorRef.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
      pendingCursorRef.current = null;
    }
  }, [text]);

  const candidates = useMemo(() => {
    // With no active `@`, still surface everyone so the picker is usable from an empty field.
    const q = (mention?.query ?? text.replace(/^@/, "")).toLowerCase().trim();
    if (!q) return members.slice(0, 8);
    return members.filter((m) => m.name.toLowerCase().includes(q) || mentionTokenFor(m).toLowerCase().includes(q)).slice(0, 8);
  }, [mention, text, members]);

  const showPicker = (mention != null || text.trim().length > 0) && candidates.length > 0;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setText(value);
    const detected = detectMention(value, e.target.selectionStart ?? value.length);
    setMention(detected ? { ...detected, index: 0 } : { start: 0, query: value.replace(/^@/, ""), index: 0 });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showPicker) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMention((m) => ({ start: m?.start ?? 0, query: m?.query ?? "", index: ((m?.index ?? 0) + 1) % candidates.length }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMention((m) => ({ start: m?.start ?? 0, query: m?.query ?? "", index: ((m?.index ?? 0) - 1 + candidates.length) % candidates.length }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = candidates[mention?.index ?? 0];
      if (pick) onPick(pick.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 14px 0 18px", borderBottom: `1px solid ${color.borderLight}`, position: "relative" }}>
        {isNarrow ? (
          <button onClick={onOpenSidebar} className="ws-hoverable" style={iconBtn}>
            <MenuIcon />
          </button>
        ) : null}
        <span style={{ fontSize: 13, color: color.mutedLight, flexShrink: 0 }}>To:</span>
        <input
          ref={inputRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="@ someone — a teammate or an agent"
          style={{ flex: 1, minWidth: 0, height: 34, border: "none", outline: "none", background: "transparent", font: `500 15px ${font.sans}`, color: color.ink }}
        />
        <button onClick={onCancel} className="ws-hoverable" title="Cancel" style={iconBtn}>
          <CloseIcon size={14} stroke={color.muted} />
        </button>

        {showPicker && (
          <div
            className="ws-sb"
            style={{
              position: "absolute",
              top: "100%",
              left: 18,
              marginTop: 6,
              width: 300,
              maxHeight: 300,
              overflowY: "auto",
              background: color.surface,
              border: `1px solid ${color.border}`,
              borderRadius: radius.lg,
              boxShadow: "0 16px 34px rgba(23,20,42,0.18)",
              padding: 4,
              zIndex: 30,
            }}
          >
            {candidates.map((m, i) => {
              const pal = paletteFor(m.id);
              return (
                <button
                  key={m.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(m.id);
                  }}
                  className="ws-hoverable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    height: 36,
                    padding: "0 8px",
                    borderRadius: radius.md,
                    background: i === (mention?.index ?? 0) ? color.surfaceMuted : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <Avatar mono={m.mono} bg={pal.bg} fg={pal.fg} size={22} square={m.kind === "agent"} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                  {m.kind === "agent" && <AgentBadge />}
                  <span style={{ flex: 1 }} />
                  <span style={{ font: `400 11.5px ${font.mono}`, color: color.mutedLight }}>@{mentionTokenFor(m)}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 40, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: radius.xl, background: color.surfaceMuted, border: `1px solid ${color.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: color.muted }}>
          <PlusIcon size={20} stroke={color.muted} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Start a direct message</div>
        <div style={{ fontSize: 13.5, color: color.mutedDark, maxWidth: 360, lineHeight: 1.5 }}>
          Type <span style={{ font: `400 12.5px ${font.mono}`, background: color.surfaceMuted, border: `1px solid ${color.border}`, padding: "1px 5px", borderRadius: 4 }}>@</span> above and pick a
          teammate or an agent. {members.length === 0 && "No one's been added to this workspace yet — "}
          {members.length === 0 && (
            <button onClick={onAddMember} style={{ background: "none", border: "none", padding: 0, color: color.accentText, cursor: "pointer", font: `500 13.5px ${font.sans}`, textDecoration: "underline" }}>
              invite someone
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: "none", padding: "0 26px 20px" }}>
        <div style={{ maxWidth: 820, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, background: color.surface, overflow: "hidden", opacity: 0.6 }}>
          <div style={{ padding: "12px 13px 6px", font: `400 14px ${font.sans}`, color: color.mutedLight }}>Message…</div>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 8px 8px" }}>
            <span style={{ flex: 1 }} />
            <span style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: radius.md, background: color.borderStrong, color: "#fff" }}>
              <SendIcon size={15} stroke="#fff" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: radius.md,
  cursor: "pointer",
  flexShrink: 0,
};
