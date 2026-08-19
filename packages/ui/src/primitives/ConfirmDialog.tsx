import { useEffect, useRef, type ReactNode } from "react";
import { color, font, radius } from "../tokens.js";
import { Dialog } from "./Dialog.js";
import { Button } from "./Button.js";

/**
 * App-styled replacement for `window.confirm` — same "are you sure?" gate, but rendered through
 * our own `Dialog` so it matches the rest of the UI (and isn't a jarring native OS alert). Mount
 * it permanently and drive it with an `open` boolean; `onConfirm`/`onClose` are the two exits.
 *
 * `destructive` (default true, since that's every current caller) paints the confirm button red.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={title} width={420}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ font: `400 13.5px ${font.sans}`, color: color.mutedDark, lineHeight: 1.55 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <button
            ref={confirmRef}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: radius.md,
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              border: "none",
              color: "#fff",
              background: destructive ? "#E05252" : color.accent,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = destructive ? "#C93F3F" : color.accentHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = destructive ? "#E05252" : color.accent)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
