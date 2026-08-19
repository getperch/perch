import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { channelId, taskId } from "@perch/core";
import { tasks as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { appendChannelEvent, emit } from "../events.js";

export const tasksApp = new OpenAPIHono<AppEnv>();

tasksApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: z.object({ channelId: channelId.optional() }) },
    responses: { 200: { content: { "application/json": { schema: contract.listTasksOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const { channelId: filterChannelId } = c.req.valid("query");
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "TASK#" },
      }),
    );
    const all = (res.Items ?? []).map((i) => i.task);
    return c.json(filterChannelId ? all.filter((t) => t.channelId === filterChannelId) : all);
  },
);

/** Backs the Tasks screen's "New task" button and a schedule's "Run now" (which just opens a task — see TasksScreen). */
tasksApp.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: { body: { content: { "application/json": { schema: contract.createTaskInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.createTaskOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const now = new Date().toISOString();
    const task = {
      id: ulid(),
      workspaceId: ctx.workspaceId,
      channelId: input.channelId,
      ownerId: input.ownerId,
      openedById: ctx.actorId,
      title: input.title,
      status: "open" as const,
      detail: input.detail,
      dueLabel: input.dueLabel,
      source: input.source,
      scheduleLabel: input.scheduleLabel,
      createdAt: now,
      updatedAt: now,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `TASK#${task.id}`, task } }));
    await appendChannelEvent(task.channelId, { type: "task.created", channelId: task.channelId, task });
    await emit(ctx, "task.created", { taskId: task.id });
    return c.json(task);
  },
);

/** Backs the checkbox toggle (done/reopen) and inline approve/decline on a task row. */
tasksApp.openapi(
  createRoute({
    method: "patch",
    path: "/{taskId}",
    request: {
      params: z.object({ taskId }),
      body: { content: { "application/json": { schema: contract.updateTaskInput.omit({ taskId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.updateTaskOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { taskId: id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `TASK#${id}` } }));
    if (!existing.Item) throw new HTTPException(404, { message: `task ${id} not found` });
    const task = { ...existing.Item.task, ...patch, updatedAt: new Date().toISOString() };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `TASK#${task.id}`, task } }));
    await appendChannelEvent(task.channelId, { type: "task.updated", channelId: task.channelId, task });
    await emit(ctx, "task.updated", { taskId: task.id });
    return c.json(task);
  },
);
