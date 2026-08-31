import { describe, expect, it } from "vitest";
import { inputSchema } from "./handler.js";

describe("github tool inputSchema", () => {
  it("rejects an unknown action", () => {
    expect(inputSchema.safeParse({ action: "delete_repo" }).success).toBe(false);
  });

  it("accepts get_issue with a numeric issue number", () => {
    const parsed = inputSchema.parse({ action: "get_issue", repo: "widgets", prNumber: 3 });
    expect(parsed).toMatchObject({ action: "get_issue", repo: "widgets", prNumber: 3 });
  });

  it("accepts close_issue with an issue number", () => {
    const parsed = inputSchema.parse({ action: "close_issue", repo: "widgets", prNumber: 3 });
    expect(parsed).toMatchObject({ action: "close_issue", repo: "widgets", prNumber: 3 });
  });

  it("accepts a create_issue action and keeps its fields", () => {
    const parsed = inputSchema.parse({ action: "create_issue", owner: "acme", repo: "widgets", title: "Something's broken" });
    expect(parsed).toMatchObject({ action: "create_issue", owner: "acme", repo: "widgets", title: "Something's broken" });
  });

  it("accepts open_pull_request", () => {
    const parsed = inputSchema.parse({ action: "open_pull_request", repo: "widgets", branch: "feat/x", title: "Add x" });
    expect(parsed.action).toBe("open_pull_request");
  });

  it("coerces nothing — a numeric prNumber stays a number, a string is rejected", () => {
    expect(inputSchema.safeParse({ action: "pr_comment", repo: "w", prNumber: 12, body: "hi" }).success).toBe(true);
    expect(inputSchema.safeParse({ action: "pr_comment", repo: "w", prNumber: "12", body: "hi" }).success).toBe(false);
  });

  it("accepts start_coding_task with a branch and instructions", () => {
    const parsed = inputSchema.parse({
      action: "start_coding_task",
      repo: "widgets",
      branch: "agent/fix-flaky-test",
      instructions: "Fix the flaky test in src/foo.test.ts",
    });
    expect(parsed).toMatchObject({ action: "start_coding_task", branch: "agent/fix-flaky-test" });
  });
});
