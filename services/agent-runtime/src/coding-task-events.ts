import { z } from "zod";
import { getRun, postMessage } from "./persist.js";

/**
 * Reports the outcome of an async `github` coding task back into the channel it started from.
 * Subscribed (see infra/api.ts) to the EventBridge `coding-task.completed` event that
 * services/tools/github-coding-agent puts on the shared bus once its clone/edit/test/push/PR loop
 * finishes — see that Lambda's handler.ts and services/tools/github's `start_coding_task` action
 * for why this is a separate async report rather than a synchronous tool result: the coding job can
 * run for minutes, well past what's safe to block the durable agent-runtime workflow on.
 *
 * A plain `sst.aws.Function`, not part of the `AgentRuntime` Workflow — there's no multi-step
 * durable state to checkpoint here, just "load the run, post a message."
 */
const detailSchema = z.object({
  workspaceId: z.string(),
  runId: z.string(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  outcome: z.enum(["success", "failure"]),
  prNumber: z.number().optional(),
  prUrl: z.string().optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

function formatText(detail: z.infer<typeof detailSchema>): string {
  const repoRef = `${detail.owner}/${detail.repo}@${detail.branch}`;
  if (detail.outcome === "success") {
    const prLine = detail.prUrl ? `\n\n${detail.prUrl}` : "";
    return `✅ Coding task on \`${repoRef}\` done — ${detail.summary ?? "opened a pull request"}.${prLine}`;
  }
  return `❌ Coding task on \`${repoRef}\` failed: ${detail.error ?? "unknown error"}`;
}

export const handler = async (event: { detail: unknown }) => {
  const detail = detailSchema.parse(event.detail);
  const run = await getRun(detail.workspaceId, detail.runId);
  if (!run) {
    // The run row is long gone (TTL, or this event is stale/replayed) — nowhere left to post to.
    console.error(`coding-task-events: run ${detail.runId} not found for workspace ${detail.workspaceId}, dropping`);
    return;
  }
  await postMessage({
    workspaceId: detail.workspaceId,
    channelId: run.channelId,
    authorId: run.agentId,
    runId: run.id,
    text: formatText(detail),
  });
};
