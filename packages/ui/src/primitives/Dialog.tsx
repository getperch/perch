import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "#00000059", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "92vw", maxHeight: "88vh", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {title != null && (
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, height: 48, padding: "0 16px", borderBottom: `1px solid ${color.border}` }}>
            <span style={{ flex: 1, minWidth: 0, font: `600 14px ${font.sans}`, color: color.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            <button
              onClick={onClose}
              className="ws-hoverable"
              title="Close"
              style={{ width: 28, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: radius.md, cursor: "pointer" }}
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="ws-sb" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
