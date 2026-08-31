import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { channelId, runId, type Run } from "@perch/core";
import { runs as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { appendChannelEvent, emit } from "../events.js";
import { getExecutionArn } from "../run-execution.js";

export const runsApp = new OpenAPIHono<AppEnv>();

/**
 * The channel's runs that are still `"running"`/`"waiting_approval"` — what backs ChatScreen's
 * live run indicator on load/reconnect (the SSE stream alone only covers runs that change state
 * *while the channel is open*; see apps/desktop/src/App.tsx's `activeRunsByChannel` comment).
 *
 * Same shape as `getWorkspaceSpendToday` (services/agent-runtime/src/persist.ts) and `GET /tasks`
 * below it: one query over every `RUN#` item for the workspace, filtered in code rather than by a
 * dedicated GSI — workspace run volume doesn't justify one yet, and the number of runs actually
 * `running` at once is small regardless of total history.
 */
runsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: z.object({ channelId }) },
    responses: { 200: { content: { "application/json": { schema: contract.listActiveRunsOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const { channelId: filterChannelId } = c.req.valid("query");
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "RUN#" },
      }),
    );
    // `i.run` guard: same partition also holds run-execution.ts's `RUNEXEC#<id>` items (a leftover
    // pre-rename item has no `.run` at all) — see that file's comment for the live crash this once
    // caused elsewhere on the exact same unguarded assumption.
    const active = (res.Items ?? [])
      .map((i) => i.run as Run | undefined)
      .filter((r): r is Run => !!r && r.channelId === filterChannelId && (r.status === "running" || r.status === "waiting_approval"));
    return c.json(active);
  },
);

runsApp.openapi(
  createRoute({
    method: "get",
    path: "/{runId}",
    request: { params: z.object({ runId }) },
    responses: { 200: { content: { "application/json": { schema: contract.getRunOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const { runId: id } = c.req.valid("param");
    const [runRes, stepsRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `RUN#${id}` } })),
      ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": `RUN#${id}`, ":prefix": "STEP#" },
        }),
      ),
    ]);
    if (!runRes.Item) throw new HTTPException(404, { message: `run ${id} not found` });
    return c.json({ run: runRes.Item.run, steps: (stepsRes.Items ?? []).map((i) => i.step) });
  },
);

/**
 * Gives up on a run stuck `"running"`/`"waiting_approval"` — marks it `"failed"` so it stops
 * showing as live (ChatScreen's indicator and RunDetailScreen both key off `run.status`), posts a
 * visible note explaining why it disappeared, and, since services/api/src/run-execution.ts now
 * persists every run's durable-execution ARN as soon as `workflow.start()` returns it, actually
 * stops the underlying Lambda execution via `workflow.stop()` (a thin wrapper over
 * `StopDurableExecutionCommand`) instead of only correcting the DB/UI state.
 *
 * The stop call is best-effort: a run stuck "running" for any real length of time is very often
 * one the durable runtime already killed on the AWS side (an unrecoverable checkpoint failure
 * tears the invocation down without ever reaching `completeRun`), so `workflow.stop()` hitting
 * `ResourceNotFoundException`/`DescribeError`-shaped failures there is an *expected* outcome, not
 * a bug — the DB-side cancel below still proceeds either way. A run pre-dating this change (or one
 * whose `RUN#<id>#EXEC` write raced and lost — see run-execution.ts) has no recorded ARN at all;
 * cancelling it still corrects the DB/UI state, it just can't reach into AWS for it.
 */
runsApp.openapi(
  createRoute({
    method: "post",
    path: "/{runId}/cancel",
    request: { params: z.object({ runId }) },
    responses: { 200: { content: { "application/json": { schema: contract.cancelRunOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { runId: id } = c.req.valid("param");
    const key = { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `RUN#${id}` };
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
    if (!existing.Item) throw new HTTPException(404, { message: `run ${id} not found` });
    const run = existing.Item.run;
    if (run.status !== "running" && run.status !== "waiting_approval") {
      throw new HTTPException(400, { message: `run ${id} already finished (status: ${run.status})` });
    }

    const actorRes = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${ctx.actorId}` } }));
    const actorName = (actorRes.Item?.member?.name as string | undefined) ?? "a workspace member";

    const executionArn = await getExecutionArn(ctx.workspaceId, id);
    if (executionArn) {
      await workflow.stop(executionArn, { error: `Cancelled by ${actorName}` }).catch((err) => {
        console.error(`run ${id}: workflow.stop(${executionArn}) failed — proceeding with the DB-side cancel anyway`, err);
      });
    } else {
      console.warn(`run ${id}: no recorded execution ARN — cancelling in the DB only`);
    }

    const updated = { ...run, status: "failed" as const, error: `Cancelled by ${actorName}`, completedAt: new Date().toISOString() };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key, run: updated } }));
    await appendChannelEvent(run.channelId, { type: "run.updated", channelId: run.channelId, run: updated });
    await emit(ctx, "run.failed", { runId: id, cancelled: true });

    const message = {
      id: ulid(),
      workspaceId: ctx.workspaceId,
      channelId: run.channelId,
      authorId: run.agentId,
      isSystem: false,
      text: `🛑 Cancelled by ${actorName}.`,
      runId: id,
      tools: [],
      citations: [],
      reactions: [],
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `CHANNEL#${run.channelId}`, sk: `MSG#${message.id}`, message } }));
    await appendChannelEvent(run.channelId, { type: "message.created", channelId: run.channelId, message });

    return c.json(updated);
  },
);
