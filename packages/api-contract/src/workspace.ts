import { z } from "zod";
import { approvalPolicy, memberId, modelId, workspace, workspaceId } from "@perch/core";

export const getWorkspaceInput = z.object({ workspaceId });
export const getWorkspaceOutput = workspace;

export const updateSpendCapInput = z.object({ workspaceId, spendCapUsdPerDay: z.number().positive() });
export const updateSpendCapOutput = workspace;

export const getSpendInput = z.object({ workspaceId });
export const getSpendOutput = z.object({
  spendCapUsdPerDay: z.number(),
  spentTodayUsd: z.number(),
  remainingUsd: z.number(),
  agents: z.array(
    z.object({
      agentId: memberId,
      name: z.string(),
      dailySpendCapUsd: z.number(),
      spentTodayUsd: z.number(),
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
  trustedPluginRegistries: z.array(z.string()).optional(),
  /** Empty string clears it back to "no default"; any other value must be a real Bedrock model id. */
  defaultModel: z.union([modelId, z.literal("")]).optional(),
});
export const updateSettingsOutput = workspace;
