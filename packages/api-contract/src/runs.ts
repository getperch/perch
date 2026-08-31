import { z } from "zod";
import { channelId, run, runId, runStep } from "@perch/core";

export const getRunInput = z.object({ runId });
export const getRunOutput = z.object({
  run,
  steps: z.array(runStep),
});

/** Backs ChatScreen's live "Run #… running" card (see apps/desktop/src/App.tsx's
 * `activeRunsByChannel`) — without this, a run already in flight when the app is opened or
 * reconnects has nothing to show until its next SSE event. `channelId` is required, not optional:
 * this is a per-channel live-status query, not a general run listing (see runs.ts's own comment
 * for why it isn't indexed/paginated). */
export const listActiveRunsInput = z.object({ channelId });
export const listActiveRunsOutput = z.array(run);

/** Lets a person give up on a run that's stuck `"running"`/`"waiting_approval"` — see
 * services/api/src/routers/runs.ts's `POST /{runId}/cancel` for what this actually does (marks the
 * DB row failed; does NOT reach into AWS to stop the underlying durable execution — see that
 * route's comment for why). */
export const cancelRunInput = z.object({ runId });
export const cancelRunOutput = run;
