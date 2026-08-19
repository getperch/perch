import { z } from "zod";
import { approvalId, channelId, memberId, runId, taskId, workspaceId } from "./ids.js";

export const taskStatus = z.enum(["open", "in_progress", "needs_approval", "done", "declined"]);

/** How the task came to exist. */
export const taskSource = z.enum([
  /** opened directly from a channel message */
  "chat",
  /** opened by a run as it worked */
  "run",
  /** opened from a direct message thread */
  "dm",
  /** opened by firing a schedule trigger (see AgentConfig.triggers) */
  "schedule",
]);
export type TaskSource = z.infer<typeof taskSource>;

export const task = z.object({
  id: taskId,
  workspaceId,
  channelId,
  ownerId: memberId,
  /** who opened the task — a person or the agent that ran into it */
  openedById: memberId.optional(),
  title: z.string().min(1),
  status: taskStatus,
  detail: z.string().optional(),
  /** free-text due label shown as a chip, e.g. "Today", "This week" — not a hard deadline */
  dueLabel: z.string().optional(),
  source: taskSource.default("chat"),
  runId: runId.optional(),
  /** set when status === "needs_approval"; resolving this approval resolves the task */
  approvalId: approvalId.optional(),
  /** set when opened by a schedule firing, e.g. "daily 07:30" */
  scheduleLabel: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof task>;
