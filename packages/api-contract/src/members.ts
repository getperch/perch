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

export const updateAgentInput = z.object({
  memberId,
  config: agentConfig.partial(),
});
export const updateAgentOutput = agentMember;

/** Permanently removes a member (agent or person) from the workspace. The workspace owner and the
 * caller themselves can't be deleted. */
export const deleteMemberInput = z.object({ memberId });
export const deleteMemberOutput = z.object({ deleted: z.literal(true) });
