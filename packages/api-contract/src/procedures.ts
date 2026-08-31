import { z } from "zod";
import { channelId, memberId, procedure, procedureId, procedureSchedule, procedureStep, workspaceId } from "@perch/core";

export const listProceduresInput = z.object({ workspaceId });
export const listProceduresOutput = z.array(procedure);

export const getProcedureInput = z.object({ procedureId });
export const getProcedureOutput = procedure;

/** Create a Routine from a reviewed step list (the recorder flow, or a hand-authored one). */
export const createProcedureInput = z.object({
  workspaceId,
  name: z.string().min(1),
  agentId: memberId,
  channelId: channelId.optional(),
  startUrl: z.string().url(),
  steps: z.array(procedureStep).default([]),
  schedule: procedureSchedule.optional(),
});
export const createProcedureOutput = procedure;

/** Edit name / steps / agent / schedule / allowedHosts. Omitted fields are left unchanged;
 * pass `schedule: null` to unschedule. */
export const updateProcedureInput = z.object({
  procedureId,
  name: z.string().min(1).optional(),
  agentId: memberId.optional(),
  channelId: channelId.optional(),
  steps: z.array(procedureStep).optional(),
  schedule: procedureSchedule.nullable().optional(),
});
export const updateProcedureOutput = procedure;

export const deleteProcedureInput = z.object({ procedureId });
export const deleteProcedureOutput = z.object({ deleted: z.literal(true) });

/* ─── Secrets (write-only; values live in SSM, never returned) ──────────────── */

export const putProcedureSecretInput = z.object({ procedureId, key: z.string().min(1), value: z.string().min(1) });
export const putProcedureSecretOutput = z.object({ stored: z.literal(true) });

export const deleteProcedureSecretInput = z.object({ procedureId, key: z.string().min(1) });
export const deleteProcedureSecretOutput = z.object({ deleted: z.literal(true) });

/* ─── Run now ──────────────────────────────────────────────────────────────── */

export const runProcedureInput = z.object({ procedureId });
export const runProcedureOutput = z.object({ runId: z.string() });
