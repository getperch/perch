import { z } from "zod";
import { approvalId, channelId, memberId, runId, workspaceId } from "./ids.js";

export const approvalStatus = z.enum(["pending", "approved", "denied"]);

/**
 * Mirrors a paused DurableContext.callback() in the agent-runtime.
 * `callbackToken` is opaque to the client — it's what the approve/deny API call forwards
 * to the Durable Execution SDK to resume the run.
 */
export const approval = z.object({
  id: approvalId,
  workspaceId,
  channelId,
  runId,
  toolName: z.string(),
  title: z.string(),
  detail: z.string(),
  status: approvalStatus,
  callbackToken: z.string(),
  resolvedById: memberId.optional(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type Approval = z.infer<typeof approval>;
