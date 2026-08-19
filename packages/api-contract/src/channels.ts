import { z } from "zod";
import { channel, channelId, memberId, workspaceId } from "@fizz/core";

export const listChannelsInput = z.object({ workspaceId });
export const listChannelsOutput = z.array(channel);

export const getChannelInput = z.object({ channelId });
export const getChannelOutput = channel;

export const createChannelInput = z.object({
  workspaceId,
  name: z.string().min(1),
  topic: z.string().optional(),
  /** Members to seed the channel with, alongside the creator (who is always added). */
  memberIds: z.array(memberId).optional(),
});
export const createChannelOutput = channel;

export const getOrCreateDirectInput = z.object({ workspaceId, otherMemberIds: z.array(memberId).min(1) });
export const getOrCreateDirectOutput = channel;

/** Adds an existing workspace member (agent or person) to a channel they're not already in. */
export const addChannelMemberInput = z.object({ channelId, memberId });
export const addChannelMemberOutput = channel;

/** Removes a member from a channel. Group channels only; the member record itself is untouched. */
export const removeChannelMemberInput = z.object({ channelId, memberId });
export const removeChannelMemberOutput = channel;

/** Edit a group channel's name and/or goal (topic). Omitted fields are left unchanged; pass an
 * empty string for `topic` to clear it. */
export const updateChannelInput = z.object({
  channelId,
  name: z.string().min(1).optional(),
  topic: z.string().optional(),
});
export const updateChannelOutput = channel;

/** Permanently removes a channel and its messages. Direct channels can't be deleted this way. */
export const deleteChannelInput = z.object({ channelId });
export const deleteChannelOutput = z.object({ deleted: z.literal(true) });
