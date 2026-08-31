import { useState } from "react";
import { Button } from "./primitives/Button.js";
import { color, font, radius } from "./tokens.js";

export function CreateChannelModal({
  busy,
  error,
  onCreate,
  onCancel,
}: {
  busy?: boolean;
  error?: string;
  onCreate: (name: string, topic?: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), goal.trim() || undefined);
  };

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "#00000059", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ width: 360, background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ font: `600 15px ${font.sans}`, color: color.ink }}>Create a channel</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: color.ink }}>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. incidents"
            style={{ height: 36, border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "0 12px", font: `400 14px ${font.sans}`, outline: "none", background: color.surface }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: color.ink }}>Goal (optional)</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            placeholder="What this channel is for — agents in it are told this."
            style={{ border: `1px solid ${color.borderStrong}`, borderRadius: radius.lg, padding: "8px 12px", font: `400 14px ${font.sans}`, outline: "none", background: color.surface, resize: "vertical" }}
          />
        </label>
        {error && <div style={{ fontSize: 12, color: color.statusDeclinedFg }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create channel"}</Button>
        </div>
      </form>
    </div>
  );
}
