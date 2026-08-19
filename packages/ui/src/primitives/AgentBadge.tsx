import { color, font } from "../tokens.js";

/** The small "AGENT" chip shown next to an agent's name everywhere it appears. */
export function AgentBadge() {
  return (
    <span
      style={{
        font: `500 9px ${font.mono}`,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: color.agentTagFg,
        background: color.agentTagBg,
        border: `1px solid ${color.agentTagBorder}`,
        borderRadius: 4,
        padding: "1px 5px",
        whiteSpace: "nowrap",
      }}
    >
      Agent
    </span>
  );
}
