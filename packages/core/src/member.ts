import { z } from "zod";
import { channelId, memberId, workspaceId } from "./ids.js";

export const memberRole = z.enum(["owner", "admin", "member"]);
export type MemberRole = z.infer<typeof memberRole>;

/** What an agent is allowed to touch. Anything not listed here, the agent cannot do. */
export const toolGrant = z.object({
  toolName: z.string(),
  needsApproval: z.boolean().default(false),
});
export type ToolGrant = z.infer<typeof toolGrant>;

export const triggerKind = z.enum(["mention", "schedule", "webhook", "relevant"]);

export const triggerConfig = z.object({
  kind: triggerKind,
  enabled: z.boolean().default(false),
  /** cron expression, required when kind === "schedule" */
  schedule: z.string().optional(),
  /** webhook path suffix, required when kind === "webhook" */
  webhookPath: z.string().optional(),
  /** short human title for this trigger, e.g. "Top 5 priorities" — schedules only, shown in the Schedules list */
  label: z.string().optional(),
  /** the standing instruction this trigger runs, distinct from the agent's general `instructions` — schedules only */
  prompt: z.string().optional(),
});
export type TriggerConfig = z.infer<typeof triggerConfig>;

/**
 * A named capability doc an agent carries in addition to its base `instructions` — composed into
 * the system prompt at invoke time (see services/agent-runtime/src/handler.ts) and, when the agent
 * is published, written as its own `skills/{name}/SKILL.md` file alongside the primary skill
 * (`instructions` itself) — see packages/core/src/plugin.ts. `name` doubles as that file's
 * directory segment, so it's constrained the same way `pluginManifest.name` is.
 */
export const skillDoc = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  description: z.string().min(1),
  body: z.string().min(1),
});
export type SkillDoc = z.infer<typeof skillDoc>;

/**
 * A Bedrock foundation-model id, e.g. `anthropic.claude-3-5-sonnet-20241022-v2:0` — exactly the
 * string `bedrock:Converse`/`ConverseStream` expects, passed straight through by the agent-runtime
 * invocation layer (services/agent-runtime/src/model.ts). Deliberately a free string, not an enum:
 * the selectable set is served dynamically from `bedrock:ListFoundationModels` via `GET /models`
 * (services/api/src/routers/models.ts), so pinning an enum here would go stale and, worse, make a
 * stored agent whose model isn't in the enum fail to decode and vanish from the app.
 */
export const modelId = z.string().min(1);

export const agentConfig = z.object({
  /** free-text instructions — the agent's system prompt */
  instructions: z.string().min(1),
  model: modelId,
  tools: z.array(toolGrant).default([]),
  triggers: z.array(triggerConfig).default([]),
  skills: z.array(skillDoc).default([]),
  /** hard cap in USD/day; the run loop refuses new steps once spend crosses this */
  dailySpendCapUsd: z.number().positive(),
  postsInChannelIds: z.array(channelId).default([]),
});
export type AgentConfig = z.infer<typeof agentConfig>;

const memberBase = z.object({
  id: memberId,
  workspaceId,
  name: z.string().min(1),
  /** short mono initials shown in the avatar, e.g. "BE" */
  mono: z.string().min(1).max(3),
  colorBg: z.string(),
  colorFg: z.string(),
  createdAt: z.string().datetime(),
});

export const person = memberBase.extend({
  kind: z.literal("person"),
  email: z.string().email(),
  role: memberRole,
});
export type Person = z.infer<typeof person>;

export const agentMember = memberBase.extend({
  kind: z.literal("agent"),
  /** @mention handle, e.g. "beacon" */
  handle: z.string().min(1),
  /** shown next to every message the agent posts */
  roleDescription: z.string().min(1),
  config: agentConfig,
});
export type AgentMember = z.infer<typeof agentMember>;

export const member = z.discriminatedUnion("kind", [person, agentMember]);
export type Member = z.infer<typeof member>;
