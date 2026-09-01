import { z } from "zod";
import { channelId, memberId, procedureId, runId, workspaceId } from "./ids.js";

/**
 * A Routine (a "procedure" in the data model): a browser workflow a person performs once in a
 * live browser while a recorder watches, saved as an ordered, named list of steps. Every run
 * after that, the agent-runtime replays the steps itself (see services/agent-runtime, `mode:
 * "procedure"`) and posts the result to a channel — no LLM in the loop for a clean run.
 */

export const procedureStepKind = z.enum([
  /** navigate to `url` */
  "goto",
  /** click the first element one of `selectors` matches */
  "click",
  /** type `value` (or the secret behind `valueRef`) into the matched field */
  "fill",
  /** choose `value` in the matched <select> */
  "select",
  /** block until one of `selectors` is present */
  "waitFor",
  /** read text into the run result under `extractKey` — the matched element's text, or, if
   * `pattern` is set, the first regex match against the whole page's visible text */
  "extract",
  /** fail the run unless the matched element's text contains `value` */
  "assert",
  /** show `label` as an instruction and pause; continue once one of `selectors` is present (or,
   * with none, once `url` — treated as a substring — appears in the address bar). For steps a
   * person must do by hand in the middle of an otherwise-automated routine (sign-in, a wizard). */
  "humanCheckpoint",
]);
export type ProcedureStepKind = z.infer<typeof procedureStepKind>;

export const procedureStep = z.object({
  id: z.string().min(1),
  kind: procedureStepKind,
  /**
   * Ranked candidate selectors (see packages/core/src/selectors.ts). Replay tries each in order;
   * first match wins. Empty for `goto` (which uses `url`).
   */
  selectors: z.array(z.string()).default([]),
  /** for `goto` */
  url: z.string().url().optional(),
  /** literal value for `fill` / `select` / `assert` — mutually exclusive with `valueRef` */
  value: z.string().optional(),
  /** `"secret:<key>"` — resolved from SSM at replay time, never stored inline */
  valueRef: z
    .string()
    .regex(/^secret:[A-Za-z0-9_.-]+$/, 'valueRef must look like "secret:<key>"')
    .optional(),
  /** human-readable name for the step, shown in the editor and the run timeline; for
   * `humanCheckpoint` this is the instruction shown to the person */
  label: z.string().optional(),
  /** for `extract` — the key its captured text is stored under in the run result */
  extractKey: z.string().optional(),
  /** for `extract` — a regex (JS syntax); the first match against the page's visible text is
   * captured instead of an element's text. Use a capture group to narrow what's kept. */
  pattern: z.string().optional(),
  /** for `click` / `humanCheckpoint` — don't fail the step if nothing matches (e.g. an
   * "Enable API" button that's absent because it's already enabled) */
  optional: z.boolean().optional(),
});
export type ProcedureStep = z.infer<typeof procedureStep>;

export const procedureSchedule = z.object({
  /** standard 5-field cron, UTC unless `timezone` says otherwise */
  cron: z.string().min(1),
  /** IANA tz, e.g. "Europe/London" */
  timezone: z.string().min(1).default("UTC"),
  /** where the result message is posted */
  channelId,
});
export type ProcedureSchedule = z.infer<typeof procedureSchedule>;

export const procedureLastRun = z.object({
  runId,
  status: z.enum(["completed", "failed"]),
  at: z.string().datetime(),
});

export const procedure = z.object({
  id: procedureId,
  workspaceId,
  name: z.string().min(1),
  /** the person who taught it — only they or a workspace admin may edit / run / delete it */
  ownerId: memberId,
  /** the agent whose identity the replay run belongs to */
  agentId: memberId,
  /** where a "Run now" / unscheduled run posts its result; a schedule overrides this with its own */
  channelId: channelId.optional(),
  startUrl: z.string().url(),
  steps: z.array(procedureStep).default([]),
  /** key names only — values live in SSM SecureString, never returned by any API */
  secretKeys: z.array(z.string()).default([]),
  schedule: procedureSchedule.optional(),
  lastRun: procedureLastRun.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Procedure = z.infer<typeof procedure>;
