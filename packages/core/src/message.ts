import { z } from "zod";
import { a2uiActionId, a2uiCard } from "./a2ui.js";
import { channelId, memberId, messageId, runId, workspaceId } from "./ids.js";

/** Stamped on the synthetic user message a client posts when someone clicks a `Button` / submits
 * a `Form` on an agent's A2UI card. Lets the chat render a compact "⚡ <label>" chip instead of
 * the raw `[ui-action] …` prompt string the agent receives. See `POST /channels/{id}/a2ui-actions`. */
export const a2uiActionRef = z.object({
  sourceMessageId: messageId,
  actionId: a2uiActionId,
  label: z.string(),
  value: z.string().optional(),
});
export type A2uiActionRef = z.infer<typeof a2uiActionRef>;

export const toolCall = z.object({
  name: z.string(),
  arg: z.string(),
  ms: z.number().nonnegative(),
});
export type ToolCall = z.infer<typeof toolCall>;

export const artifactRef = z.object({
  name: z.string(),
  ext: z.string(),
  meta: z.string(),
  url: z.string().url(),
});
export type ArtifactRef = z.infer<typeof artifactRef>;

export const citation = z.object({
  n: z.number().int().positive(),
  label: z.string(),
  url: z.string().url().optional(),
});
export type Citation = z.infer<typeof citation>;

export const approvalRequestSummary = z.object({
  approvalId: z.string(),
  title: z.string(),
  detail: z.string(),
  status: z.enum(["pending", "approved", "denied"]),
});

/** One member's reaction to a message, e.g. an agent's 👍 acknowledging it's picked up the work. */
export const reaction = z.object({
  emoji: z.string(),
  memberId,
});
export type Reaction = z.infer<typeof reaction>;

/** A single post in a channel. System messages (joins, run started/finished) share the same shape with isSystem=true. */
export const message = z.object({
  id: messageId,
  workspaceId,
  channelId,
  authorId: memberId.optional(),
  isSystem: z.boolean().default(false),
  text: z.string().optional(),
  runId: runId.optional(),
  tools: z.array(toolCall).default([]),
  artifact: artifactRef.optional(),
  citations: z.array(citation).default([]),
  /** A declarative UI card an agent rendered via the `render_ui` tool — drawn by `@perch/ui`'s
   * `A2uiBlock` alongside (or instead of) `text`. Shallow on the wire (`a2uiCard`); the renderer
   * re-parses it against the strict `a2uiDocument` before drawing. See `a2ui.ts`. */
  a2ui: a2uiCard.optional(),
  /** Present on the synthetic user message posted when someone acts on an A2UI card (Button /
   * Form). The chat renders this as a compact chip; `text` carries the agent-facing prompt. */
  a2uiAction: a2uiActionRef.optional(),
  approval: approvalRequestSummary.optional(),
  reactions: z.array(reaction).default([]),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().optional(),
  /** Soft-deleted: `text` is cleared and the client renders a placeholder, but the row (and its
   * audit trail) is kept rather than removed, matching this product's audit-everything posture. */
  deletedAt: z.string().datetime().optional(),
});
export type Message = z.infer<typeof message>;
