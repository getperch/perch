import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AgentMember, Run } from "@fizz/core";
import { workspace as contract } from "@fizz/api-contract";
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
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: "META", workspace: next } }));
    await emit(ctx, "workspace.updated", { approvalPolicy: next.approvalPolicy });
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
    const todayStart = new Date().toISOString().slice(0, 10);

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

    const byAgentUsd: Record<string, number> = {};
    let spentTodayUsd = 0;
    for (const run of (runsRes.Items ?? []).map((i) => i.run as Run)) {
      if (run.startedAt.slice(0, 10) !== todayStart) continue;
      spentTodayUsd += run.costUsd;
      byAgentUsd[run.agentId] = (byAgentUsd[run.agentId] ?? 0) + run.costUsd;
    }

    const agentMembers = (membersRes.Items ?? []).map((i) => i.member).filter((m): m is AgentMember => m.kind === "agent");

    return c.json({
      spendCapUsdPerDay: workspaceRes.Item.workspace.spendCapUsdPerDay,
      spentTodayUsd,
      remainingUsd: Math.max(0, workspaceRes.Item.workspace.spendCapUsdPerDay - spentTodayUsd),
      agents: agentMembers.map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        dailySpendCapUsd: agent.config.dailySpendCapUsd,
        spentTodayUsd: byAgentUsd[agent.id] ?? 0,
      })),
    });
  },
);
