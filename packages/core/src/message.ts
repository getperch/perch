import { z } from "zod";
import { channelId, memberId, messageId, runId, workspaceId } from "./ids.js";

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
  approval: approvalRequestSummary.optional(),
  reactions: z.array(reaction).default([]),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().optional(),
  /** Soft-deleted: `text` is cleared and the client renders a placeholder, but the row (and its
   * audit trail) is kept rather than removed, matching this product's audit-everything posture. */
  deletedAt: z.string().datetime().optional(),
});
export type Message = z.infer<typeof message>;
