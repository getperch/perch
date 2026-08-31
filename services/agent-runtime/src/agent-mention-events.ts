import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { z } from "zod";

/**
 * The half of agent-mentions.ts's fix that actually starts the mentioned agent's run — split into
 * its own Lambda (see that file's header comment) purely so it can `link: [agentRuntime]` normally
 * (infra/api.ts, declared after `agentRuntime` exists) instead of `agentRuntime` needing to link to
 * itself. Same shape as coding-task-events.ts: one small handler that turns one bus event into one
 * `workflow.start()` call.
 */
const detailSchema = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  channelName: z.string().optional(),
  channelTopic: z.string().optional(),
  messageId: z.string(),
  agentId: z.string(),
  triggeredBy: z.string(),
  actorId: z.string(),
  prompt: z.string(),
  depth: z.number().int().nonnegative(),
});

export const handler = async (event: { detail: unknown }) => {
  const detail = detailSchema.parse(event.detail);
  const runId = ulid();
  await workflow.start(Resource.AgentRuntime, {
    name: `mention-${runId}`,
    payload: {
      workspaceId: detail.workspaceId,
      channelId: detail.channelId,
      messageId: detail.messageId,
      mode: "direct" as const,
      agentId: detail.agentId,
      triggeredBy: detail.triggeredBy,
      actorId: detail.actorId,
      channelName: detail.channelName,
      channelTopic: detail.channelTopic,
      prompt: detail.prompt,
      runId,
      depth: detail.depth,
    },
  });
};
