import { z } from "zod";
import { run, runId, runStep } from "@fizz/core";

export const getRunInput = z.object({ runId });
export const getRunOutput = z.object({
  run,
  steps: z.array(runStep),
});
