import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { getGithubConfig } from "./github-token.js";

/**
 * The `github` tool: everything here is a plain, fast REST call against the GitHub API — no
 * sandbox, no persisted filesystem. Auth is one workspace-level fine-grained access token from the
 * GitHub connector (Settings → Connectors) — see services/tools/github/src/github-token.ts and
 * packages/core/src/connector.ts.
 *
 * Actual coding work (clone / edit / test / commit / push / open a PR) does NOT happen here any
 * more — it used to run inline against a Bedrock AgentCore Code Interpreter session (see git
 * history for session.ts, removed), which turned out not to have a `git` binary at all
 * ("/bin/sh: line 1: git: command not found", confirmed live). `start_coding_task` instead hands
 * the job off, fire-and-forget, to services/tools/github-coding-agent — a container-image Lambda
 * that gets its own isolated Firecracker microVM with a real `git`, does the whole clone → edit →
 * test → push → PR loop in one invocation against its local `/tmp`, and reports back over
 * EventBridge when it's done (see services/agent-runtime/src/coding-task-events.ts, which posts
 * the outcome into the channel). This tool call itself just returns an immediate acknowledgement —
 * see the "Explicit, accepted tradeoff" discussion this design replaced in
 * services/agent-runtime/src/handler.ts's file comment for why keeping the *synchronous* Gateway
 * tool call short matters (a multi-minute blocking call here risks the durable checkpoint token
 * ageing out — confirmed live as `InvalidParameterValueException: Invalid checkpoint token`).
 *
 * Invoked directly by Bedrock AgentCore Gateway as a lambda-type target (see infra/gateway.ts) —
 * `event` is the flat tool-arguments object plus the reserved `__workspaceId` / `__runId` keys
 * services/agent-runtime/src/tools.ts injects. AgentCore's inline tool schema has no enum/oneOf, so
 * this is one `action` string plus flat optional fields — same shape as the gmail/calendar tools.
 */
export const inputSchema = z.object({
  action: z.enum(["create_issue", "open_pull_request", "pr_comment", "start_coding_task"]),
  owner: z.string().optional().describe("repo owner (org or user) — defaults to the connector's default owner"),
  repo: z.string().optional().describe("repo name — required for every action"),
  title: z.string().optional().describe("create_issue: issue title; open_pull_request: PR title"),
  body: z.string().optional().describe("create_issue / open_pull_request: body text; pr_comment: comment text"),
  prNumber: z.number().int().positive().optional().describe("pr_comment: the pull request number"),
  branch: z.string().optional().describe("open_pull_request: head branch; start_coding_task: new branch to create the work on"),
  baseBranch: z.string().optional().describe("open_pull_request / start_coding_task: base branch to target — defaults to the repo default"),
  instructions: z
    .string()
    .optional()
    .describe("start_coding_task: what to do — the coding agent reads this and decides which files to change, tests to run, etc."),
});
type Input = z.infer<typeof inputSchema>;

const reservedContextSchema = z.object({ workspaceId: z.string(), runId: z.string() });

function extractContext(event: Record<string, unknown>) {
  return reservedContextSchema.parse({ workspaceId: event.__workspaceId, runId: event.__runId });
}

function stripReservedKeys(event: Record<string, unknown>): Record<string, unknown> {
  const { __workspaceId, __agentId, __runId, ...rest } = event;
  return rest;
}

function need<K extends keyof Input>(input: Input, key: K, action: string): NonNullable<Input[K]> {
  const v = input[key];
  if (v === undefined || v === null || v === "") throw new Error(`"${action}" requires "${String(key)}"`);
  return v as NonNullable<Input[K]>;
}

const GITHUB_API = "https://api.github.com";

async function callGithub(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "perch-agent",
      ...init?.headers,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`github: ${init?.method ?? "GET"} ${path} -> HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
    throw new Error(`GitHub API request failed (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
  }
  return bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
}

const lambda = new LambdaClient({ region: process.env.HOME_REGION });
const CODING_AGENT_FUNCTION_NAME = process.env.CODING_AGENT_FUNCTION_NAME ?? "";

/** Payload the coding-agent Lambda's own inputSchema expects — kept in sync by hand, since there's
 * no shared package between the two services (same convention as the rest of services/tools/*). */
type CodingTaskPayload = {
  workspaceId: string;
  runId: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch?: string;
  instructions: string;
};

export const handler = async (rawEvent: unknown) => {
  const event = typeof rawEvent === "object" && rawEvent !== null ? (rawEvent as Record<string, unknown>) : {};
  const { workspaceId, runId } = extractContext(event);
  const input = inputSchema.parse(stripReservedKeys(event));
  console.log(`github: run=${runId} action=${input.action}`);

  const { token, defaultOwner } = await getGithubConfig(workspaceId);
  const owner = input.owner || defaultOwner;

  try {
    switch (input.action) {
      case "create_issue": {
        const repo = need(input, "repo", input.action);
        const title = need(input, "title", input.action);
        if (!owner) throw new Error('"create_issue" needs an owner — set a default owner on the GitHub connector or pass "owner"');
        const issue = (await callGithub(token, `/repos/${owner}/${repo}/issues`, {
          method: "POST",
          body: JSON.stringify({ title, body: input.body ?? "" }),
        })) as { number?: number; html_url?: string };
        return { ok: true, issueNumber: issue.number, url: issue.html_url };
      }

      case "open_pull_request": {
        const repo = need(input, "repo", input.action);
        const head = need(input, "branch", input.action);
        const title = need(input, "title", input.action);
        if (!owner) throw new Error('"open_pull_request" needs an owner — set a default owner on the GitHub connector or pass "owner"');
        const pr = (await callGithub(token, `/repos/${owner}/${repo}/pulls`, {
          method: "POST",
          body: JSON.stringify({ title, body: input.body ?? "", head, base: input.baseBranch || undefined }),
        })) as { number?: number; html_url?: string };
        return { ok: true, prNumber: pr.number, url: pr.html_url };
      }

      case "pr_comment": {
        const repo = need(input, "repo", input.action);
        const prNumber = need(input, "prNumber", input.action);
        const bodyText = need(input, "body", input.action);
        if (!owner) throw new Error('"pr_comment" needs an owner');
        const comment = (await callGithub(token, `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: bodyText }),
        })) as { html_url?: string };
        return { ok: true, url: comment.html_url };
      }

      case "start_coding_task": {
        const repo = need(input, "repo", input.action);
        const branch = need(input, "branch", input.action);
        const instructions = need(input, "instructions", input.action);
        if (!owner) throw new Error('"start_coding_task" needs an owner — set a default owner on the GitHub connector or pass "owner"');
        if (!CODING_AGENT_FUNCTION_NAME) throw new Error("github: CODING_AGENT_FUNCTION_NAME is not set — check infra/api.ts");
        const payload: CodingTaskPayload = { workspaceId, runId, owner, repo, branch, baseBranch: input.baseBranch, instructions };
        // Fire-and-forget: `InvocationType: "Event"` returns as soon as Lambda has accepted the
        // invoke, well before the coding agent's own clone/edit/test/push loop runs. That loop can
        // take minutes — see this file's header comment for why it must NOT block this call.
        await lambda.send(
          new InvokeCommand({ FunctionName: CODING_AGENT_FUNCTION_NAME, InvocationType: "Event", Payload: JSON.stringify(payload) }),
        );
        return {
          ok: true,
          started: true,
          message: `Started a coding task on branch "${branch}" — I'll post an update in this channel when it's done.`,
        };
      }

      default:
        throw new Error(`unhandled action "${(input as Input).action}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`github: action=${input.action} failed: ${message}`);
    throw new Error(message);
  }
};
