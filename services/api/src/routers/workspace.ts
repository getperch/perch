import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AgentMember, Run } from "@perch/core";
import { workspace as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { emit } from "../events.js";

export const workspaceApp = new OpenAPIHono<AppEnv>();

workspaceApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.getWorkspaceOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: "META" } }));
    if (!res.Item) throw new HTTPException(404, { message: `workspace ${workspaceId} not found` });
    return c.json(res.Item.workspace);
  },
);

workspaceApp.openapi(
  createRoute({
    method: "patch",
    path: "/spend-cap",
    request: { body: { content: { "application/json": { schema: contract.updateSpendCapInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.updateSpendCapOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { spendCapUsdPerDay } = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: "META" } }));
    if (!existing.Item) throw new HTTPException(404, { message: `workspace ${ctx.workspaceId} not found` });
    const next = { ...existing.Item.workspace, spendCapUsdPerDay };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: "META", workspace: next } }));
    await emit(ctx, "workspace.updated", { spendCapUsdPerDay: next.spendCapUsdPerDay });
    return c.json(next);
  },
);

workspaceApp.openapi(
  createRoute({
    method: "patch",
    path: "/settings",
    request: { body: { content: { "application/json": { schema: contract.updateSettingsInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.updateSettingsOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const patch = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: "META" } }));
    if (!existing.Item) throw new HTTPException(404, { message: `workspace ${ctx.workspaceId} not found` });
    const next = { ...existing.Item.workspace, ...patch };
    // `defaultModel: ""` is the "clear it" signal from Settings — drop the key rather than storing a blank.
    if (patch.defaultModel === "") delete next.defaultModel;
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: "META", workspace: next } }));
    await emit(ctx, "workspace.updated", patch);
    return c.json(next);
  },
);

workspaceApp.openapi(
  createRoute({
    method: "get",
    path: "/spend",
    responses: { 200: { content: { "application/json": { schema: contract.getSpendOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const nowIso = new Date().toISOString();
    const todayStart = nowIso.slice(0, 10); // YYYY-MM-DD
    const monthStart = nowIso.slice(0, 7); // YYYY-MM

    const [workspaceRes, runsRes, membersRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: "META" } })),
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "RUN#" },
        }),
      ),
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "MEMBER#" },
        }),
      ),
    ]);
    if (!workspaceRes.Item) throw new HTTPException(404, { message: `workspace ${workspaceId} not found` });

    const byAgentTodayUsd: Record<string, number> = {};
    const activeByAgent: Record<string, "running" | "waiting_approval"> = {};
    const lastRunAtByAgent: Record<string, string> = {};
    let spentTodayUsd = 0;
    let spentThisMonthUsd = 0;
    // Same partition also holds run-execution.ts's `RUNEXEC#<id>` items — `.run` guard keeps a
    // leftover pre-rename one (no `.run` attribute at all) from crashing this the way it once did
    // live on the exact same unguarded assumption elsewhere.
    for (const run of (runsRes.Items ?? []).map((i) => i.run as Run | undefined).filter((r): r is Run => !!r)) {
      const day = run.startedAt.slice(0, 10);
      if (day.slice(0, 7) === monthStart) spentThisMonthUsd += run.costUsd;
      if (day === todayStart) {
        spentTodayUsd += run.costUsd;
        byAgentTodayUsd[run.agentId] = (byAgentTodayUsd[run.agentId] ?? 0) + run.costUsd;
      }
      if (!lastRunAtByAgent[run.agentId] || run.startedAt > lastRunAtByAgent[run.agentId]!) {
        lastRunAtByAgent[run.agentId] = run.startedAt;
      }
      // "running" wins over "waiting_approval" if the agent has both in flight.
      if (run.status === "running" || run.status === "queued") activeByAgent[run.agentId] = "running";
      else if (run.status === "waiting_approval" && activeByAgent[run.agentId] !== "running") {
        activeByAgent[run.agentId] = "waiting_approval";
      }
    }

    const agentMembers = (membersRes.Items ?? []).map((i) => i.member).filter((m): m is AgentMember => m.kind === "agent");

    return c.json({
      spendCapUsdPerDay: workspaceRes.Item.workspace.spendCapUsdPerDay,
      spentTodayUsd,
      spentThisMonthUsd,
      remainingUsd: Math.max(0, workspaceRes.Item.workspace.spendCapUsdPerDay - spentTodayUsd),
      agents: agentMembers.map((agent) => {
        const status: "running" | "waiting_approval" | "idle" = activeByAgent[agent.id] ?? "idle";
        return {
          agentId: agent.id,
          name: agent.name,
          dailySpendCapUsd: agent.config.dailySpendCapUsd,
          spentTodayUsd: byAgentTodayUsd[agent.id] ?? 0,
          status,
          lastRunAt: lastRunAtByAgent[agent.id],
        };
      }),
    });
  },
);
