import { z } from "zod";
import { workspaceId } from "./ids.js";
import { modelId } from "./member.js";

/**
 * Who can approve an action an agent asks to take.
 * "channel": anyone present in the channel the ask was posted in.
 * "requester": only whoever's message/DM triggered the run that's asking.
 * "admin": only workspace owners/admins — slowest, tightest, for production changes.
 */
export const approvalPolicy = z.enum(["channel", "requester", "admin"]);
export type ApprovalPolicy = z.infer<typeof approvalPolicy>;

export const workspace = z.object({
  id: workspaceId,
  name: z.string().min(1),
  spendCapUsdPerDay: z.number().positive(),
  /** Default policy for who can approve a gated tool call; agents inherit this unless noted otherwise. */
  approvalPolicy: approvalPolicy.default("channel"),
  /** A run that crosses this many steps pauses and asks a human before continuing. */
  maxStepsPerRun: z.number().int().positive().default(25),
  /** Across all agents in the workspace at once. */
  maxConcurrentRuns: z.number().int().positive().default(6),
  /** Hostnames a workspace admin has approved for "Import from URL" in the plugin picker — see plugins.ts's import route. */
  trustedPluginRegistries: z.array(z.string()).default([]),
  /** Bedrock model id new agents are pre-filled with in the "Add member → Agent" screen. Optional:
   * an unset workspace just leaves the picker empty and the creator chooses. Not a hard fallback at
   * run time — an agent always stores its own resolved `config.model`. */
  defaultModel: modelId.optional(),
  createdAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspace>;
