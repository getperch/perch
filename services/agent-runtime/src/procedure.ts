import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { chromium, type Page } from "playwright-core";
import { Agent } from "@strands-agents/sdk";
import { ulid } from "ulid";
import type { workflow } from "sst/aws/workflow";
import type { Procedure, ProcedureStep } from "@perch/core";
import { ddb, TABLE_NAME } from "./db.js";
import { appendRunStep, completeRun, createRun, loadAgentConfig } from "./persist.js";
import { postMessage } from "./persist.js";
import { resolveModel } from "./model.js";
import { startBrowserSession, stopBrowserSession } from "./browser.js";
import { sanitizeRunError } from "./sanitize.js";

export type ProcedureRunEvent = {
  kind: "procedure";
  workspaceId: string;
  procedureId: string;
  agentId: string;
  /** pre-allocated by `POST /procedures/{id}/run` so the endpoint can return it immediately */
  runId: string;
  triggeredBy: string;
  actorId: string;
};

const STAGE = process.env.STAGE ?? "dev";
const ssm = new SSMClient({ region: process.env.HOME_REGION });

async function loadProcedure(workspaceId: string, procedureId: string): Promise<Procedure> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `PROCEDURE#${procedureId}` } }));
  if (!res.Item) throw new Error(`procedure ${procedureId} not found`);
  return res.Item.procedure as Procedure;
}

async function resolveSecret(workspaceId: string, procedureId: string, key: string): Promise<string> {
  const res = await ssm.send(
    new GetParameterCommand({ Name: `/perch/${STAGE}/${workspaceId}/procedure/${procedureId}/${key}`, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`the routine's "${key}" secret isn't set — open the routine and add it`);
  return value;
}

async function firstMatch(page: Page, selectors: string[], timeoutMs = 8000): Promise<import("playwright-core").Locator> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  for (;;) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if ((await loc.count()) > 0) return loc;
      } catch (err) {
        lastErr = err;
      }
    }
    if (Date.now() > deadline) break;
    await page.waitForTimeout(250);
  }
  throw new Error(`no element matched ${JSON.stringify(selectors)}${lastErr ? ` (${(lastErr as Error).message})` : ""}`);
}

type StepContext = {
  page: Page;
  workspaceId: string;
  procedureId: string;
  extracted: Record<string, string>;
};

async function executeStep(step: ProcedureStep, cx: StepContext): Promise<void> {
  const { page } = cx;
  switch (step.kind) {
    case "goto": {
      if (!step.url) throw new Error("goto step has no url");
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      break;
    }
    case "waitFor": {
      await firstMatch(page, step.selectors);
      break;
    }
    case "click": {
      const el = await firstMatch(page, step.selectors).catch((err) => {
        if (step.optional) return undefined;
        throw err;
      });
      if (el) await el.click();
      break;
    }
    case "fill": {
      const value = step.valueRef
        ? await resolveSecret(cx.workspaceId, cx.procedureId, step.valueRef.slice("secret:".length))
        : step.value ?? "";
      await (await firstMatch(page, step.selectors)).fill(value);
      break;
    }
    case "select": {
      await (await firstMatch(page, step.selectors)).selectOption(step.value ?? "");
      break;
    }
    case "extract": {
      let text: string;
      if (step.pattern) {
        const body = await page.locator("body").innerText().catch(() => "");
        const m = body.match(new RegExp(step.pattern));
        text = (m?.[1] ?? m?.[0] ?? "").trim();
      } else {
        text = (await (await firstMatch(page, step.selectors)).innerText()).trim();
      }
      cx.extracted[step.extractKey || step.label || step.id] = text.slice(0, 2000);
      break;
    }
    case "assert": {
      const text = await (await firstMatch(page, step.selectors)).innerText();
      if (step.value && !text.includes(step.value)) throw new Error(`assertion failed: "${step.value}" not found in "${text.slice(0, 120)}"`);
      break;
    }
    case "humanCheckpoint": {
      // No human is present for a cloud replay. Treat it as a wait for the post-checkpoint state
      // (its `selectors`, or `url` as a substring); skip if `optional`, fail otherwise.
      if (step.selectors.length) {
        await firstMatch(page, step.selectors, step.optional ? 8000 : 30000).catch((err) => {
          if (!step.optional) throw err;
        });
      } else if (step.url) {
        const deadline = Date.now() + (step.optional ? 8000 : 30000);
        while (!page.url().includes(step.url)) {
          if (Date.now() > deadline) {
            if (step.optional) break;
            throw new Error(`humanCheckpoint "${step.label ?? step.id}": "${step.url}" never appeared in the URL`);
          }
          await page.waitForTimeout(1000);
        }
      }
      break;
    }
  }
}

/** One model-assisted retry: ask for a better selector for a step whose selectors all missed. */
async function repairSelector(model: string, page: Page, step: ProcedureStep): Promise<string | undefined> {
  try {
    const dom = (await page.content()).replace(/<script[\s\S]*?<\/script>/gi, "").slice(0, 12000);
    const agent = new Agent({ tools: [], model: resolveModel(model), systemPrompt: "You output exactly one CSS selector and nothing else." });
    const out = await agent.invoke(
      `On the current page, selectors ${JSON.stringify(step.selectors)} no longer match the control labelled "${step.label ?? step.kind}". ` +
        `Given this HTML, reply with ONE robust CSS selector for that control — no quotes, no prose.\n\n${dom}`,
    );
    const sel = (typeof out === "string" ? out : String(out)).trim().split("\n")[0]?.trim();
    return sel && sel.length < 400 ? sel : undefined;
  } catch {
    return undefined;
  }
}

/** Surfaces a scheduled routine run in the Tasks screen (`source: "schedule"`). Only for schedule
 * fires — a manual "Run now" already shows up as a run, and doesn't need a task row too. */
async function writeScheduleTask(
  procedure: Procedure,
  channelId: string,
  runId: string,
  status: "done" | "declined",
): Promise<void> {
  if (!procedure.schedule) return;
  const now = new Date().toISOString();
  const task = {
    id: ulid(),
    workspaceId: procedure.workspaceId,
    channelId,
    ownerId: procedure.agentId,
    openedById: procedure.agentId,
    title: procedure.name,
    status,
    detail: `Scheduled routine replay — ${procedure.steps.length} steps.`,
    source: "schedule" as const,
    runId,
    scheduleLabel: procedure.schedule.cron,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${procedure.workspaceId}`, sk: `TASK#${task.id}`, task } }));
}

async function writeLastRun(procedure: Procedure, runId: string, status: "completed" | "failed"): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `WORKSPACE#${procedure.workspaceId}`,
        sk: `PROCEDURE#${procedure.id}`,
        procedure: { ...procedure, lastRun: { runId, status, at: new Date().toISOString() }, updatedAt: new Date().toISOString() },
      },
    }),
  );
}

/**
 * Replay a taught routine: drive its steps against a fresh AgentCore browser session (login runs
 * every time — no session is persisted), allow one model-assisted selector repair per step, then
 * post a result to the routine's channel. Invoked from handler.ts when `event.kind === "procedure"`.
 *
 * No navigation allowlist: real login flows cross hosts (SSO, OAuth redirects), routines are
 * authored and reviewed by the same workspace member, and the replay browser is ephemeral and
 * per-run — every replay is still an audited `Run` and only the owner/an admin can edit or run it.
 */
export async function runProcedure(event: ProcedureRunEvent, ctx: workflow.Context): Promise<{ runId: string }> {
  const procedure = await ctx.step("load-procedure", () => loadProcedure(event.workspaceId, event.procedureId));
  const agent = await ctx.step("load-agent", () => loadAgentConfig(event.workspaceId, event.agentId));
  const channelId = procedure.schedule?.channelId ?? procedure.channelId;
  if (!channelId) throw new Error(`routine "${procedure.name}" has no result channel — set one before running it`);

  const run = await ctx.step("create-run", () =>
    createRun({
      workspaceId: event.workspaceId,
      channelId,
      agentId: agent.id,
      title: procedure.name,
      triggeredBy: event.triggeredBy,
      runId: event.runId,
    }),
  );

  const session = await startBrowserSession();
  const browser = await chromium.connectOverCDP(session.automationEndpoint);
  const extracted: Record<string, string> = {};

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const cx: StepContext = { page, workspaceId: event.workspaceId, procedureId: procedure.id, extracted };

    for (const [i, step] of procedure.steps.entries()) {
      const label = step.label || `${step.kind} #${i + 1}`;
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      try {
        await executeStep(step, cx);
      } catch (firstErr) {
        const repaired = step.selectors.length ? await repairSelector(agent.config.model, page, step) : undefined;
        if (!repaired) throw firstErr;
        await executeStep({ ...step, selectors: [repaired, ...step.selectors] }, cx);
        await appendRunStep(run, { kind: "reasoning", name: `Repaired selector for "${label}"`, detail: repaired, startedAt });
      }
      await appendRunStep(run, {
        kind: "tool_call",
        name: label,
        detail: step.kind === "extract" ? `${step.extractKey ?? "value"} = ${extracted[step.extractKey || step.label || step.id] ?? ""}`.slice(0, 200) : undefined,
        durationMs: Date.now() - t0,
        startedAt,
      });
    }

    const lines = Object.entries(extracted).map(([k, v]) => `• *${k}*: ${v}`);
    await ctx.step("post-result", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId,
        authorId: agent.id,
        runId: run.id,
        text:
          `✅ Ran routine *${procedure.name}* — ${procedure.steps.length} step${procedure.steps.length === 1 ? "" : "s"}.` +
          (lines.length ? `\n\n${lines.join("\n")}` : ""),
      }),
    );
    await ctx.step("complete-run", () => completeRun(run, "completed"));
    await ctx.step("write-last-run", () => writeLastRun(procedure, run.id, "completed"));
    if (event.triggeredBy.startsWith("schedule")) {
      await ctx.step("write-schedule-task", () => writeScheduleTask(procedure, channelId, run.id, "done"));
    }
    return { runId: run.id };
  } catch (err) {
    const reason = sanitizeRunError(err);
    console.error(`agent-runtime: procedure run ${run.id} failed:`, err instanceof Error ? err.stack : err);
    await ctx.step("fail-run", () => completeRun(run, "failed", { error: reason }));
    await ctx.step("record-failure-step", () =>
      appendRunStep(run, { kind: "reasoning", name: "Routine failed", detail: reason, startedAt: new Date().toISOString() }),
    );
    await ctx.step("post-failure", () =>
      postMessage({
        workspaceId: event.workspaceId,
        channelId,
        authorId: agent.id,
        runId: run.id,
        text: `⚠️ I couldn't finish the routine *${procedure.name}*: ${reason}`,
      }),
    );
    await ctx.step("write-last-run-failed", () => writeLastRun(procedure, run.id, "failed"));
    if (event.triggeredBy.startsWith("schedule")) {
      await ctx.step("write-schedule-task-failed", () => writeScheduleTask(procedure, channelId, run.id, "declined"));
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
    await stopBrowserSession(session.sessionId);
  }
}
