import { z } from "zod";
import { channelId, memberId, messageId, workspaceId } from "@fizz/core";

export const getMentionsInput = z.object({ workspaceId });

/** One @-mention of the current user, flattened across every channel they're in. Assembled
 * server-side (see services/api/src/routers/mentions.ts) — there's no stored "mention" record. */
export const mention = z.object({
  messageId,
  channelId,
  channelName: z.string(),
  authorId: memberId.optional(),
  authorKind: z.enum(["person", "agent"]),
  authorName: z.string(),
  authorMono: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  /** Heuristic: posted within the last 24h. The app has no per-user read cursor. */
  unread: z.boolean(),
});
export type Mention = z.infer<typeof mention>;

export const listMentionsOutput = z.array(mention);
