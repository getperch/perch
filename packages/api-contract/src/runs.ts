import { z } from "zod";
import { run, runId, runStep } from "@perch/core";

export const getRunInput = z.object({ runId });
export const getRunOutput = z.object({
  run,
  steps: z.array(runStep),
});
