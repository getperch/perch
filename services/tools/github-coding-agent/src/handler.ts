import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { z } from "zod";
import { getGithubConfig } from "./github-token.js";
import { makeRepoTools, redact } from "./repo-tools.js";

const exec = promisify(execCb);

/**
 * The actual coding-agent work: clone a GitHub repo, edit files, run builds/tests, commit, push,
 * open a pull request — all inside this Lambda's own `/tmp`, in its own isolated Firecracker
 * microVM. Invoked fire-and-forget (`InvocationType: "Event"`) by services/tools/github's
 * `start_coding_task` action — see that file's header comment for why this had to move off the
 * old Bedrock AgentCore Code Interpreter session (no `git` binary there) and off the synchronous
 * Gateway tool-call path (a multi-minute blocking call risks the durable checkpoint token ageing
 * out in services/agent-runtime).
 *
 * One invocation does the whole job start to finish, so there's no cross-call filesystem to keep
 * alive — the thing services/tools/github/src/session.ts used to exist for. Reports its outcome by
 * putting one event on the shared EventBridge bus; services/agent-runtime/src/coding-task-events.ts
 * picks it up and posts the result into the channel the run started from.
 *
 * `handler.timeout` in infra/api.ts is a hard ceiling — a task that's still going when it hits it
 * is killed mid-work with no completion event. Accepted for now; see the "one open constraint"
 * this design punted on — chaining invocations to work past 15 minutes reintroduces the very
 * cross-call state problem this design avoids, so it's deferred until a real task actually needs it.
 */
const inputSchema = z.object({
  workspaceId: z.string(),
  runId: z.string(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  baseBranch: z.string().optional(),
  instructions: z.string(),
  /** The workspace's chosen model (Settings → General → "Coding agent model" — see
   * services/tools/github/src/handler.ts's `lookupCodingAgentModel`), if it set one. Absent for a
   * workspace that never visited Settings, or if that lookup itself failed — either way falls back
   * to `DEFAULT_MODEL_ID` below rather than failing the task outright. */
  modelId: z.string().optional(),
});
type Input = z.infer<typeof inputSchema>;

const CHECKOUT_DIR = "/tmp/repo";
const BOT_NAME = "Perch Agent";
const BOT_EMAIL = "agent@perch.bot";
const GITHUB_API = "https://api.github.com";

const eventBridge = new EventBridgeClient({ region: process.env.HOME_REGION });
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? "";
/** No shared model resolver with services/agent-runtime/src/model.ts — this Lambda has no "agent"
 * member of its own to carry a `config.model`. Used only when the workspace hasn't chosen one via
 * Settings (`input.modelId`, above) — was itself left as `""` at one point and confirmed live as
 * the cause of every coding task failing outright ("Truncated event message received" — Bedrock's
 * generic error for a Converse/ConverseStream call with no valid model id), so infra/api.ts now
 * always sets this to something real. */
const DEFAULT_MODEL_ID = process.env.CODING_AGENT_MODEL_ID ?? "";

type Outcome =
  | { outcome: "success"; prNumber?: number; prUrl?: string; summary: string }
  | { outcome: "failure"; error: string };

async function reportOutcome(input: Input, result: Outcome) {
  if (!EVENT_BUS_NAME) {
    console.error("github-coding-agent: EVENT_BUS_NAME is not set — cannot report outcome, check infra/api.ts");
    return;
  }
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS_NAME,
          Source: "workspace.github-coding-agent",
          DetailType: "coding-task.completed",
          Detail: JSON.stringify({ workspaceId: input.workspaceId, runId: input.runId, owner: input.owner, repo: input.repo, branch: input.branch, ...result }),
        },
      ],
    }),
  );
}

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
  if (!res.ok) throw new Error(`GitHub API request failed (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
  return bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
}

export const handler = async (rawEvent: unknown) => {
  const input = inputSchema.parse(rawEvent);
  console.log(`github-coding-agent: run=${input.runId} repo=${input.owner}/${input.repo} branch=${input.branch}`);

  let token = "";
  try {
    ({ token } = await getGithubConfig(input.workspaceId));

    const cloneUrl = `https://x-access-token:${token}@github.com/${input.owner}/${input.repo}.git`;
    await exec(
      [
        `rm -rf ${CHECKOUT_DIR}`,
        `git clone --depth 50 ${cloneUrl} ${CHECKOUT_DIR}`,
        `cd ${CHECKOUT_DIR}`,
        `git config user.name ${JSON.stringify(BOT_NAME)}`,
        `git config user.email ${JSON.stringify(BOT_EMAIL)}`,
        `git checkout -b ${JSON.stringify(input.branch)}`,
      ].join(" && "),
      { timeout: 5 * 60 * 1000 },
    ).catch((err: { stdout?: string; stderr?: string; message: string }) => {
      throw new Error(`clone failed: ${redact(err.stderr || err.stdout || err.message, token)}`);
    });

    const { readFile, writeFile, listFiles, runCommand } = makeRepoTools(CHECKOUT_DIR, token);

    let submitted: { prNumber?: number; prUrl?: string; summary: string } | undefined;

    const submitWork = {
      name: "submit_work" as const,
      description:
        "Call this exactly once, when the working tree has the change you were asked to make and any tests you " +
        "ran pass. Commits everything, pushes the branch, and opens a pull request — do not run `git` yourself.",
      inputSchema: z.object({
        commitMessage: z.string(),
        prTitle: z.string(),
        prBody: z.string().optional(),
        summary: z.string().describe("A short summary of what changed, for the message posted back to the user."),
      }),
      callback: async ({ commitMessage, prTitle, prBody, summary }: { commitMessage: string; prTitle: string; prBody?: string; summary: string }) => {
        await exec(`git add -A && git commit -m ${JSON.stringify(commitMessage)} && git push -u origin ${JSON.stringify(input.branch)}`, {
          cwd: CHECKOUT_DIR,
          timeout: 5 * 60 * 1000,
        }).catch((err: { stdout?: string; stderr?: string; message: string }) => {
          throw new Error(`commit/push failed: ${redact(err.stderr || err.stdout || err.message, token)}`);
        });
        const pr = (await callGithub(token, `/repos/${input.owner}/${input.repo}/pulls`, {
          method: "POST",
          body: JSON.stringify({ title: prTitle, body: prBody ?? "", head: input.branch, base: input.baseBranch || undefined }),
        })) as { number?: number; html_url?: string };
        submitted = { prNumber: pr.number, prUrl: pr.html_url, summary };
        return { ok: true, prNumber: pr.number, url: pr.html_url };
      },
    };

    const agent = new Agent({
      tools: [readFile, writeFile, listFiles, runCommand, tool(submitWork)],
      model: new BedrockModel({ modelId: input.modelId || DEFAULT_MODEL_ID }),
      systemPrompt:
        "You are a coding agent working inside a fresh checkout of a GitHub repository at the root of your " +
        "filesystem access. Make the change described below, run any relevant build/test/lint commands via " +
        "run_command to verify it, then call submit_work exactly once to commit, push, and open a pull request. " +
        "If you get stuck or the task can't be completed, explain why in your final reply instead of calling " +
        "submit_work.",
    });

    await agent.invoke(input.instructions);

    if (submitted) {
      await reportOutcome(input, { outcome: "success", ...submitted });
    } else {
      await reportOutcome(input, { outcome: "failure", error: "The coding agent finished without submitting a change — see its run for why." });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`github-coding-agent: run=${input.runId} failed: ${redact(message, token)}`);
    await reportOutcome(input, { outcome: "failure", error: redact(message, token) });
  }
};
