import { z } from "zod";
import { approvalPolicy, memberId, workspace, workspaceId } from "@perch/core";

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

/** Backs the Settings screen's Approvals + Limits cards. */
export const updateSettingsInput = z.object({
  workspaceId,
  approvalPolicy: approvalPolicy.optional(),
  maxStepsPerRun: z.number().int().positive().optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
  trustedPluginRegistries: z.array(z.string()).optional(),
});
export const updateSettingsOutput = workspace;
