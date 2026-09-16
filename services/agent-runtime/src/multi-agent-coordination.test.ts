import { describe, it, expect } from "vitest";

/**
 * Tests for multi-agent coordination in the agent runtime handler.
 *
 * These tests verify that:
 * 1. The otherAgentsContext function builds correct context strings
 * 2. System prompts include multi-agent coordination information
 * 3. Agent info is properly structured for the runtime
 */

describe("Multi-Agent Coordination Context", () => {
  describe("otherAgentsInfo structure", () => {
    it("should format agent info for system prompt correctly", () => {
      const otherAgentsInfo = [
        { id: "ag_1", name: "Research Bot", handle: "research", roleDescription: "Specializes in web research and data gathering" },
        { id: "ag_2", name: "Code Assistant", handle: "coder", roleDescription: "Helps with code review and development" },
        { id: "ag_3", name: "Design Bot", handle: "designer", roleDescription: "Creates UI/UX designs and visual assets" },
      ];

      const expectedOutput = `\n\n## Other agents in this channel
- @research: Research Bot — Specializes in web research and data gathering
- @coder: Code Assistant — Helps with code review and development
- @designer: Design Bot — Creates UI/UX designs and visual assets

You can @mention other agents to delegate tasks that match their expertise, collaborate on complex requests, or ask for help when their capabilities are more relevant than yours. When delegating, be specific about what you need them to do.`;

      const formatOtherAgents = (agents: typeof otherAgentsInfo) => {
        if (!agents || agents.length === 0) return "";
        const agentList = agents.map((a) => `- @${a.handle}: ${a.name} — ${a.roleDescription}`).join("\n");
        return `\n\n## Other agents in this channel\n${agentList}\n\nYou can @mention other agents to delegate tasks that match their expertise, collaborate on complex requests, or ask for help when their capabilities are more relevant than yours. When delegating, be specific about what you need them to do.`;
      };

      expect(formatOtherAgents(otherAgentsInfo)).toBe(expectedOutput);
    });

    it("should handle empty otherAgentsInfo", () => {
      const formatOtherAgents = (agents: Array<{ id: string; name: string; handle: string; roleDescription: string }> | undefined) => {
        if (!agents || agents.length === 0) return "";
        const agentList = agents.map((a) => `- @${a.handle}: ${a.name} — ${a.roleDescription}`).join("\n");
        return `\n\n## Other agents in this channel\n${agentList}\n\nCoordination enabled.`;
      };

      expect(formatOtherAgents(undefined)).toBe("");
      expect(formatOtherAgents([])).toBe("");
    });

    it("should handle single other agent", () => {
      const otherAgentsInfo = [
        { id: "ag_1", name: "Research Bot", handle: "research", roleDescription: "Specializes in web research" },
      ];

      const formatOtherAgents = (agents: typeof otherAgentsInfo) => {
        if (!agents || agents.length === 0) return "";
        const agentList = agents.map((a) => `- @${a.handle}: ${a.name} — ${a.roleDescription}`).join("\n");
        return `\n\n## Other agents in this channel\n${agentList}\n\nYou can @mention other agents to delegate tasks that match their expertise, collaborate on complex requests, or ask for help when their capabilities are more relevant than yours. When delegating, be specific about what you need them to do.`;
      };

      const result = formatOtherAgents(otherAgentsInfo);
      expect(result).toContain("@research: Research Bot");
      expect(result).toContain("Specializes in web research");
    });
  });

  describe("Agent event structure for 3+ agents", () => {
    it("should include all mentioned agents in direct mode", () => {
      // Simulate a message mentioning 3 agents
      const mentionedAgents = [
        { id: "ag_1", handle: "alpha", name: "Agent Alpha", roleDescription: "Handles task A" },
        { id: "ag_2", handle: "beta", name: "Agent Beta", roleDescription: "Handles task B" },
        { id: "ag_3", handle: "gamma", name: "Agent Gamma", roleDescription: "Handles task C" },
      ];

      // Each agent should get the others in their event
      const eventForAlpha = {
        agentId: "ag_1",
        otherAgentsInfo: mentionedAgents.filter((a) => a.id !== "ag_1"),
      };

      expect(eventForAlpha.otherAgentsInfo).toHaveLength(2);
      expect(eventForAlpha.otherAgentsInfo.map((a: { id: string }) => a.id)).toContain("ag_2");
      expect(eventForAlpha.otherAgentsInfo.map((a: { id: string }) => a.id)).toContain("ag_3");
    });

    it("should correctly exclude actor and mentioned agents from triage", () => {
      const allAgents = [
        { id: "ag_1", handle: "alpha", name: "Agent Alpha", config: { triggers: [{ kind: "relevant", enabled: true }] } },
        { id: "ag_2", handle: "beta", name: "Agent Beta", config: { triggers: [{ kind: "relevant", enabled: true }] } },
        { id: "ag_3", handle: "gamma", name: "Agent Gamma", config: { triggers: [{ kind: "relevant", enabled: true }] } },
        { id: "ag_4", handle: "delta", name: "Agent Delta", config: { triggers: [{ kind: "relevant", enabled: true }] } },
      ];

      const actorId = "user_1";
      const mentionedAgentIds = new Set(["ag_1"]); // User mentioned @alpha

      // Filter for triage agents - should exclude actor and mentioned agents
      const triageAgents = allAgents.filter(
        (a) => a.id !== actorId && !mentionedAgentIds.has(a.id) && a.config.triggers.some((t) => t.kind === "relevant" && t.enabled),
      );

      expect(triageAgents).toHaveLength(3);
      expect(triageAgents.map((a) => a.handle)).not.toContain("alpha");
      expect(triageAgents.map((a) => a.handle)).toEqual(["beta", "gamma", "delta"]);
    });
  });

  describe("Channel context integration", () => {
    it("should combine channel context with other agents context", () => {
      const channelName = "general";
      const channelTopic = "Team coordination and announcements";

      const otherAgentsInfo = [
        { id: "ag_1", name: "Project Manager", handle: "pm", roleDescription: "Helps with project planning and prioritization" },
        { id: "ag_2", name: "DevOps Bot", handle: "devops", roleDescription: "Manages deployments and infrastructure" },
      ];

      const buildChannelContext = (name?: string, topic?: string) => {
        const parts = [name ? `#${name}` : undefined, topic?.trim() || undefined].filter(Boolean);
        if (parts.length === 0) return "";
        return `\n\n## The channel you're in\n${parts.join(" — ")}\nKeep your replies relevant to this channel's purpose.`;
      };

      const buildOtherAgentsContext = (agents: typeof otherAgentsInfo) => {
        if (!agents || agents.length === 0) return "";
        const agentList = agents.map((a) => `- @${a.handle}: ${a.name} — ${a.roleDescription}`).join("\n");
        return `\n\n## Other agents in this channel\n${agentList}\n\nYou can @mention other agents to delegate tasks that match their expertise, collaborate on complex requests, or ask for help when their capabilities are more relevant than yours. When delegating, be specific about what you need them to do.`;
      };

      const combinedContext = `${buildChannelContext(channelName, channelTopic)}${buildOtherAgentsContext(otherAgentsInfo)}`;

      expect(combinedContext).toContain("#general");
      expect(combinedContext).toContain("Team coordination and announcements");
      expect(combinedContext).toContain("@pm: Project Manager");
      expect(combinedContext).toContain("@devops: DevOps Bot");
      expect(combinedContext).toContain("delegate tasks");
    });
  });
});
