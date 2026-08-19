import { z } from "zod";
import { channelId, memberId, workspaceId } from "./ids.js";

export const channel = z.object({
  id: channelId,
  workspaceId,
  name: z.string().min(1),
  topic: z.string().optional(),
  memberIds: z.array(memberId).default([]),
  /** "direct" channels are 1:1 or a small ad-hoc group (not a persistent named channel) and are
   * hidden from the sidebar's Channels list (see Sidebar's directs). */
  kind: z.enum(["group", "direct"]).default("group"),
  createdAt: z.string().datetime(),
});
export type Channel = z.infer<typeof channel>;
