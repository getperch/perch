import { z } from "zod";
import { channelId, memberId, runId, runStepId, workspaceId } from "./ids.js";

export const runStatus = z.enum(["queued", "running", "waiting_approval", "completed", "failed"]);
export type RunStatus = z.infer<typeof runStatus>;

export const runStepKind = z.enum(["reasoning", "tool_call", "approval_wait", "trigger_wait"]);

export const runStep = z.object({
  id: runStepId,
  runId,
  kind: runStepKind,
  name: z.string(),
  detail: z.string().optional(),
  code: z.string().optional(),
  tokens: z.string().optional(),
  /** Set on a "tool_call" step for a tool whose result carries one, e.g. the browser tool's AgentCore session recording. */
  recordingUrl: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  startedAt: z.string().datetime(),
});
export type RunStep = z.infer<typeof runStep>;

export const run = z.object({
  id: runId,
  workspaceId,
  channelId,
  agentId: memberId,
  status: runStatus,
  title: z.string(),
  /** e.g. "@mention", "schedule: 0 9 * * *" */
  triggeredBy: z.string(),
  costUsd: z.number().nonnegative().default(0),
  tokensUsed: z.number().nonnegative().default(0),
  /** Set when `status === "failed"`: a short, human-readable reason, already stripped of ARNs,
   * account ids, and stack frames so it's safe to show in a channel and on the run page. */
  error: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Run = z.infer<typeof run>;
