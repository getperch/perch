import { z } from "zod";
import { channelId, memberId, task, taskId, taskSource, taskStatus, workspaceId } from "@perch/core";

export const listTasksInput = z.object({
  workspaceId,
  channelId: channelId.optional(),
});
export const listTasksOutput = z.array(task);

/** Backs the Tasks screen's "New task" button and a schedule's "Run now". */
export const createTaskInput = z.object({
  workspaceId,
  channelId,
  ownerId: memberId,
  title: z.string().min(1),
  detail: z.string().optional(),
  dueLabel: z.string().optional(),
  source: taskSource.default("chat"),
  scheduleLabel: z.string().optional(),
});
export const createTaskOutput = task;

/** Backs the checkbox toggle (done/reopen) and inline approve/decline on a task row. */
export const updateTaskInput = z.object({
  taskId,
  status: taskStatus.optional(),
  detail: z.string().optional(),
});
export const updateTaskOutput = task;
