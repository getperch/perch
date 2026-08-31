import { z } from "zod";
import { approvalPolicy, memberId, workspace, workspaceId } from "@perch/core";

export const getWorkspaceInput = z.object({ workspaceId });
export const getWorkspaceOutput = workspace;

export const updateSpendCapInput = z.object({ workspaceId, spendCapUsdPerDay: z.number().positive() });
export const updateSpendCapOutput = workspace;

export const getSpendInput = z.object({ workspaceId });
export const agentActivityStatus = z.enum(["running", "waiting_approval", "idle"]);
export const getSpendOutput = z.object({
  spendCapUsdPerDay: z.number(),
  spentTodayUsd: z.number(),
  /** Calendar month-to-date, workspace-wide. Backs the Home screen's headline spend stat. */
  spentThisMonthUsd: z.number(),
  remainingUsd: z.number(),
  agents: z.array(
    z.object({
      agentId: memberId,
      name: z.string(),
      dailySpendCapUsd: z.number(),
      spentTodayUsd: z.number(),
      /** "running" = a run is queued or in flight; "waiting_approval" = a run is paused on a
       * human; "idle" = nothing active. Drives the Home screen's Agent activity list. */
      status: agentActivityStatus,
      /** ISO timestamp of the agent's most recent run, if it has ever run. */
      lastRunAt: z.string().optional(),
    }),
  ),
});

/** Backs the Settings screen's General + Approvals + Limits cards. */
export const updateSettingsInput = z.object({
  workspaceId,
  name: z.string().trim().min(1).max(80).optional(),
  approvalPolicy: approvalPolicy.optional(),
  maxStepsPerRun: z.number().int().positive().optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
  /** A Bedrock model id, or "" to clear it back to "no default" (the server drops the key on "").
   * Kept as a plain string rather than `z.union([modelId, z.literal("")])`: the union serialises to
   * an OpenAPI `anyOf` of two string schemas, which the desktop app's Rust type codegen (typify)
   * turns into a broken flattened struct that fails to deserialise any string — so picking a default
   * model errored. */
  defaultModel: z.string().optional(),
});
export const updateSettingsOutput = workspace;
