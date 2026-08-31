import { z } from "zod";
import { a2uiActionId, channelId, memberId, message, messageId } from "@perch/core";

export const listMessagesInput = z.object({
  channelId,
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export const listMessagesOutput = z.object({
  /** Ordered oldest -> newest. A cursorless call returns the newest page. */
  messages: z.array(message),
  /** Pass back as `cursor` to fetch the page of OLDER messages preceding this one; absent at the start of history. */
  nextCursor: z.string().optional(),
});

export const sendMessageInput = z.object({
  channelId,
  text: z.string().min(1),
  /** explicit agent to route to; omit for auto-assign */
  assigneeId: memberId.optional(),
});
export const sendMessageOutput = message;

/** Toggles the caller's reaction: adds it if not already reacted with this emoji, removes it if already present. */
export const toggleReactionInput = z.object({ channelId, messageId, emoji: z.string().min(1) });
export const toggleReactionOutput = message;

export const editMessageInput = z.object({ channelId, messageId, text: z.string().min(1) });
export const editMessageOutput = message;

export const deleteMessageInput = z.object({ channelId, messageId });
export const deleteMessageOutput = message;

/** The viewer clicked an A2UI `Button` on `sourceMessageId`. The server records it as a normal
 * user message (`[ui-action] …`) and starts a follow-up turn for the agent that posted the card.
 * `actionId` must match a Button actually declared on that message. */
export const a2uiActionInput = z.object({
  channelId,
  sourceMessageId: messageId,
  actionId: a2uiActionId,
  /** echoed back from the clicked Button's `value` prop, if it had one */
  value: z.string().max(500).optional(),
  /** field name -> entered value, when the action is a `Form` submit */
  formData: z.record(z.string(), z.string().max(5000)).optional(),
});
export const a2uiActionOutput = message;
