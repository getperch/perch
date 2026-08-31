import { z } from "zod";
import {
  agentConfig,
  agentMember,
  channelId,
  member,
  memberId,
  memberRole,
  person,
  workspaceId,
} from "@perch/core";

export const listMembersInput = z.object({ workspaceId });
export const listMembersOutput = z.array(member);

export const meOutput = person;

export const createPersonInput = z.object({
  workspaceId,
  name: z.string().min(1),
  email: z.string().email(),
  role: memberRole,
  channelIds: z.array(channelId).default([]),
});
export const createPersonOutput = person;

/** Backs the "Add member -> Agent" screen: identity, instructions, tools, model, triggers, guardrails. */
export const createAgentInput = z.object({
  workspaceId,
  name: z.string().min(1),
  handle: z.string().min(1),
  roleDescription: z.string().min(1),
  colorBg: z.string(),
  colorFg: z.string(),
  config: agentConfig,
});
export const createAgentOutput = agentMember;

/** PATCH body for an existing agent — any subset of its editable fields. `config` is itself a
 * partial, so a single field (e.g. `instructions`) can be updated without resending the rest.
 *
 * NB: this is NOT `agentConfig.partial()`. Under `.partial()`, an *absent* array field that has a
 * `.default([])` (tools, triggers, skills, postsInChannelIds) still parses to `[]` rather than
 * staying absent — so a patch of just `{triggers}` would arrive as `{triggers, tools:[], skills:[],
 * postsInChannelIds:[]}` and the server's `{...current, ...patch}` merge would silently wipe those
 * three. `.removeDefault()` on each keeps absent keys absent. */
export const updateAgentConfigPatch = z
  .object({
    instructions: agentConfig.shape.instructions,
    model: agentConfig.shape.model,
    tools: agentConfig.shape.tools.removeDefault(),
    triggers: agentConfig.shape.triggers.removeDefault(),
    skills: agentConfig.shape.skills.removeDefault(),
    dailySpendCapUsd: agentConfig.shape.dailySpendCapUsd,
    postsInChannelIds: agentConfig.shape.postsInChannelIds.removeDefault(),
    ui: agentConfig.shape.ui.removeDefault(),
  })
  .partial();

export const updateAgentPatch = z.object({
  roleDescription: z.string().min(1).optional(),
  config: updateAgentConfigPatch.optional(),
});
export const updateAgentInput = updateAgentPatch.extend({ memberId });
export const updateAgentOutput = agentMember;

/** Rename a Person. A caller may rename themselves; an admin/owner may rename anyone. */
export const updatePersonInput = z.object({ memberId, name: z.string().min(1).max(80) });
export const updatePersonOutput = person;

/** Permanently removes a member (agent or person) from the workspace. The workspace owner and the
 * caller themselves can't be deleted. */
export const deleteMemberInput = z.object({ memberId });
export const deleteMemberOutput = z.object({ deleted: z.literal(true) });

/** "Run now" on a Schedules-list row: fire the agent's schedule trigger at `triggerIndex`
 * immediately, reusing that agent's tools/model, and post to the trigger's resolved channel. */
export const runAgentScheduleInput = z.object({ memberId, triggerIndex: z.number().int().nonnegative() });
export const runAgentScheduleOutput = z.object({ runId: z.string() });
