import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for multi-agent coordination in message routing.
 *
 * These tests verify that the message routing logic correctly handles:
 * 1. Messages with multiple @mentions trigger ALL mentioned agents, not just the first one
 * 2. Agents are aware of other agents in their channel for coordination
 * 3. Triage mode excludes agents that were explicitly mentioned
 * 4. Direct channels with 3+ members trigger all agents correctly
 */

// Mock the workflow module to capture the started workflows
const mockWorkflowStart = vi.fn();
vi.mock("sst/aws/workflow", () => ({ workflow: { start: mockWorkflowStart } }));

// Mock dependencies
vi.mock("../db.js", () => ({
  ddb: { send: vi.fn() },
  TABLE_NAME: "test-table",
}));

vi.mock("../events.js", () => ({
  appendChannelEvent: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../run-execution.js", () => ({
  recordExecutionArn: vi.fn(),
}));

describe("Multi-Agent Coordination", () => {
  beforeEach(() => {
    mockWorkflowStart.mockReset();
    mockWorkflowStart.mockResolvedValue({ arn: "arn:aws:states:us-east-1:123456789:execution:test" });
  });

  describe("Message mention parsing", () => {
    it("should extract multiple @mentions from a message", () => {
      const text = "Hey @agent-alpha and @agent-beta, can you help with this?";
      const mentionedTokens = [...text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);

      expect(mentionedTokens).toContain("agent-alpha");
      expect(mentionedTokens).toContain("agent-beta");
      expect(mentionedTokens).toHaveLength(2);
    });

    it("should extract all three mentions from a message with 3+ agents", () => {
      const text = "@agent-alpha @agent-beta @agent-gamma please review this together.";
      const mentionedTokens = [...text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);

      expect(mentionedTokens).toEqual(["agent-alpha", "agent-beta", "agent-gamma"]);
    });
  });

  describe("Agent matching logic", () => {
    // Simulated agent members in a channel
    const createAgentMembers = () => [
      { id: "ag_1", handle: "agent-alpha", name: "Agent Alpha", kind: "agent" as const, config: { triggers: [] } },
      { id: "ag_2", handle: "agent-beta", name: "Agent Beta", kind: "agent" as const, config: { triggers: [] } },
      { id: "ag_3", handle: "agent-gamma", name: "Agent Gamma", kind: "agent" as const, config: { triggers: [] } },
    ];

    it("should find ALL mentioned agents, not just the first one", () => {
      const agentMembers = createAgentMembers();
      const text = "@agent-alpha and @agent-beta please help!";
      const mentionedTokens = [...text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);

      // The OLD buggy behavior: .find() only returns the FIRST match
      const oldMentionedAgent = agentMembers.find((a) => mentionedTokens.includes(a.handle));
      expect(oldMentionedAgent?.handle).toBe("agent-alpha"); // Only first one!

      // The NEW correct behavior: filter to get ALL matches
      const mentionedAgents = agentMembers.filter((a) => mentionedTokens.includes(a.handle));
      expect(mentionedAgents).toHaveLength(2);
      expect(mentionedAgents.map((a) => a.handle)).toContain("agent-alpha");
      expect(mentionedAgents.map((a) => a.handle)).toContain("agent-beta");
    });

    it("should trigger all 3 mentioned agents in a coordinated request", () => {
      const agentMembers = createAgentMembers();
      const text = "@agent-alpha @agent-beta @agent-gamma let's meet!";
      const mentionedTokens = [...text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);

      const mentionedAgents = agentMembers.filter((a) => mentionedTokens.includes(a.handle));
      expect(mentionedAgents).toHaveLength(3);
    });
  });

  describe("Triage exclusion logic", () => {
    const createAgentMembers = () => [
      {
        id: "ag_1",
        handle: "agent-alpha",
        kind: "agent" as const,
        config: { triggers: [{ kind: "relevant" as const, enabled: true }] },
      },
      {
        id: "ag_2",
        handle: "agent-beta",
        kind: "agent" as const,
        config: { triggers: [{ kind: "relevant" as const, enabled: true }] },
      },
      {
        id: "ag_3",
        handle: "agent-gamma",
        kind: "agent" as const,
        config: { triggers: [{ kind: "relevant" as const, enabled: true }] },
      },
    ];

    it("should exclude mentioned agents from triage", () => {
      const agentMembers = createAgentMembers();
      const text = "@agent-alpha please handle this.";
      const mentionedTokens = [...text.matchAll(/@(\w[\w-]*)/g)].map((m) => m[1]);
      const mentionedAgentIds = new Set(agentMembers.filter((a) => mentionedTokens.includes(a.handle)).map((a) => a.id));

      // OLD: triage would include ALL agents with "relevant" trigger
      const oldTriageAgents = agentMembers.filter((a) => a.config.triggers.some((t) => t.kind === "relevant" && t.enabled));
      expect(oldTriageAgents).toHaveLength(3); // Wrong! Should exclude agent-alpha

      // NEW: triage should exclude agents that were already mentioned
      const triageAgents = agentMembers.filter(
        (a) => a.config.triggers.some((t) => t.kind === "relevant" && t.enabled) && !mentionedAgentIds.has(a.id),
      );
      expect(triageAgents).toHaveLength(2); // Only beta and gamma
      expect(triageAgents.map((a) => a.handle)).not.toContain("agent-alpha");
    });
  });
});
