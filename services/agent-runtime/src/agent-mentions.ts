import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { AgentMember, Channel, Member } from "@perch/core";
import { ddb, TABLE_NAME } from "./db.js";
import { listMembers } from "./persist.js";

/**
 * The other half of the fix for https://github.com/getperch/perch/issues/3 ("group coordination
 * fails... agents may fail to delegate tasks properly"). `recentActivityBlock` (handler.ts) fixed
 * an agent's *visibility* into what other agents already said; this fixes the actual gap: an
 * agent's own reply mentioning another agent (e.g. "I'll loop in @rich") used to do nothing.
 * `postMessage` (persist.ts) just writes the row — only services/api/src/routers/messages.ts's
 * `sendMessage` route ever parses `@handle` and dispatches a run, and it only runs for a *person's*
 * HTTP request, never for an agent's own reply.
 *
 * This can't just call `workflow.start(Resource.AgentRuntime, ...)` directly from here: that needs
 * `Resource.AgentRuntime` bound via SST's `link`, and a resource can't link to itself in its own
 * constructor (the `agentRuntime` JS variable doesn't exist yet while defining `agentRuntime`) —
 * the exact circular-construction problem infra/api.ts's `routineScheduleGroupName` comment
 * already documents for a different resource. So instead of dispatching directly, this only puts
 * one event per mentioned agent on the shared bus; `agent-mention-events.ts` — a separate,
 * ordinarily-linked Lambda, the same shape as `coding-task-events.ts` — is what actually calls
 * `workflow.start()`, same trick used there for the same underlying reason.
 */
const MAX_MENTION_DEPTH = 3;
const MENTION_RE = /@(\w[\w-]*)/g;

const eventBridge = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "workspace-bus";

export type DispatchMentionsInput = {
  workspaceId: string;
  channelId: string;
  channelName?: string;
  channelTopic?: string;
  /** The message that carries the mention — becomes the dispatched run's `messageId` (what the
   * 👍 reaction and `recentActivityBlock`'s "don't quote yourself" exclusion key off). */
  messageId: string;
  /** The replying agent's own text — becomes the mentioned agent's `prompt`, so it's actually
   * reading what it was asked rather than a bare re-trigger with no content. */
  text: string;
  repliedByAgentId: string;
  /** The original human actor who kicked off this whole chain — carried through for lineage, not
   * actively used by handler.ts today (see its own `actorId` field comment). */
  actorId: string;
  /** 0 for the message that started this turn (a person's), N for an agent-to-agent hop N deep. */
  depth: number;
};

/** Scans a just-posted agent reply for `@handle`s naming *other* agents actually in this channel,
 * and puts one dispatch event on the bus per match — never calls `workflow.start` itself. */
export async function dispatchMentions(input: DispatchMentionsInput): Promise<void> {
  if (input.depth >= MAX_MENTION_DEPTH) {
    console.log(`agent-mentions: depth ${input.depth} at or past cap (${MAX_MENTION_DEPTH}) — not dispatching further`);
    return;
  }

  const tokens = new Set([...input.text.matchAll(MENTION_RE)].map((m) => m[1]!));
  if (tokens.size === 0) return;

  const [channelRes, membersRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${input.workspaceId}`, sk: `CHANNEL#${input.channelId}` } })),
    listAgentMembers(input.workspaceId),
  ]);
  const channel: Channel | undefined = channelRes.Item?.channel;
  if (!channel) return;

  const targets = membersRes.filter(
    (m) => tokens.has(m.handle) && channel.memberIds.includes(m.id) && m.id !== input.repliedByAgentId,
  );
  if (targets.length === 0) return;

  await eventBridge.send(
    new PutEventsCommand({
      Entries: targets.map((agent) => ({
        EventBusName: EVENT_BUS_NAME,
        // Deliberately not `emit()`'s `workspace.agent-runtime` source — that's the audit fan-out
        // source (see infra/events.ts), and this isn't an audit-worthy action in its own right, so
        // it gets its own source rather than showing up as a "dropped, didn't match the audit
        // schema" line in audit-writer's logs on every single mention.
        Source: "workspace.agent-mentions",
        DetailType: "agent.mentioned",
        Detail: JSON.stringify({
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          channelName: input.channelName,
          channelTopic: input.channelTopic,
          messageId: input.messageId,
          agentId: agent.id,
          triggeredBy: `@${agent.handle}`,
          actorId: input.actorId,
          prompt: input.text,
          depth: input.depth + 1,
        }),
      })),
    }),
  );
}

async function listAgentMembers(workspaceId: string): Promise<AgentMember[]> {
  const members: Member[] = await listMembers(workspaceId);
  return members.filter((m): m is AgentMember => m.kind === "agent");
}
