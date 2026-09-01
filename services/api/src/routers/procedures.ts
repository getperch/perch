import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { workflow } from "sst/aws/workflow";
import { ulid } from "ulid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { procedure as procedureSchema, procedureId } from "@perch/core";
import { procedures as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { emit } from "../events.js";
import { deleteProcedureSchedule, deleteProcedureSecret, putProcedureSecret, syncProcedureSchedule } from "../procedures-support.js";

export const proceduresApp = new OpenAPIHono<AppEnv>();

const keyOf = (workspaceId: string, id: string) => ({ pk: `WORKSPACE#${workspaceId}`, sk: `PROCEDURE#${id}` });
async function loadProcedure(workspaceId: string, id: string) {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: keyOf(workspaceId, id) }));
  if (!res.Item) throw new HTTPException(404, { message: `procedure ${id} not found` });
  return procedureSchema.parse(res.Item.procedure);
}

/** Edit / delete / run / secrets are limited to the routine's owner or a workspace admin/owner —
 * a replay drives a logged-in browser session, so who can change its steps matters. */
async function assertCanManage(workspaceId: string, actorId: string, ownerId: string) {
  if (actorId === ownerId) return;
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${actorId}` } }));
  const member = res.Item?.member as { kind?: string; role?: string } | undefined;
  if (member?.kind === "person" && (member.role === "owner" || member.role === "admin")) return;
  throw new HTTPException(403, { message: "only the routine's owner or a workspace admin can do this" });
}

proceduresApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listProceduresOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk and begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKSPACE#${workspaceId}`, ":prefix": "PROCEDURE#" },
      }),
    );
    return c.json((res.Items ?? []).map((i) => procedureSchema.parse(i.procedure)));
  },
);

proceduresApp.openapi(
  createRoute({
    method: "get",
    path: "/{procedureId}",
    request: { params: z.object({ procedureId }) },
    responses: { 200: { content: { "application/json": { schema: contract.getProcedureOutput } }, description: "OK" } },
  }),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const { procedureId: id } = c.req.valid("param");
    return c.json(await loadProcedure(workspaceId, id));
  },
);

proceduresApp.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: { body: { content: { "application/json": { schema: contract.createProcedureInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.createProcedureOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    const now = new Date().toISOString();
    const secretKeys = Array.from(
      new Set(
        input.steps
          .map((s) => s.valueRef?.slice("secret:".length))
          .filter((k): k is string => !!k),
      ),
    );
    const procedure = procedureSchema.parse({
      id: ulid(),
      workspaceId: ctx.workspaceId,
      name: input.name,
      ownerId: ctx.actorId,
      agentId: input.agentId,
      channelId: input.channelId,
      startUrl: input.startUrl,
      steps: input.steps,
      secretKeys,
      schedule: input.schedule,
      createdAt: now,
      updatedAt: now,
    });
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...keyOf(ctx.workspaceId, procedure.id), procedure } }));
    if (procedure.schedule) await syncProcedureSchedule(procedure);
    await emit(ctx, "procedure.created", { procedureId: procedure.id });
    return c.json(procedure);
  },
);

proceduresApp.openapi(
  createRoute({
    method: "patch",
    path: "/{procedureId}",
    request: {
      params: z.object({ procedureId }),
      body: { content: { "application/json": { schema: contract.updateProcedureInput.omit({ procedureId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.updateProcedureOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { procedureId: id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const existing = await loadProcedure(ctx.workspaceId, id);
    await assertCanManage(ctx.workspaceId, ctx.actorId, existing.ownerId);

    const steps = patch.steps ?? existing.steps;
    const secretKeys = Array.from(
      new Set(steps.map((s) => s.valueRef?.slice("secret:".length)).filter((k): k is string => !!k)),
    );
    const procedure = procedureSchema.parse({
      ...existing,
      name: patch.name ?? existing.name,
      agentId: patch.agentId ?? existing.agentId,
      channelId: patch.channelId ?? existing.channelId,
      steps,
      schedule: patch.schedule === null ? undefined : patch.schedule ?? existing.schedule,
      secretKeys,
      updatedAt: new Date().toISOString(),
    });
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...keyOf(ctx.workspaceId, procedure.id), procedure } }));
    await syncProcedureSchedule(procedure).catch((err) => console.error("procedure update: schedule sync failed", err));
    await emit(ctx, "procedure.updated", { procedureId: procedure.id });
    return c.json(procedure);
  },
);

proceduresApp.openapi(
  createRoute({
    method: "delete",
    path: "/{procedureId}",
    request: { params: z.object({ procedureId }) },
    responses: { 200: { content: { "application/json": { schema: contract.deleteProcedureOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { procedureId: id } = c.req.valid("param");
    const existing = await loadProcedure(ctx.workspaceId, id);
    await assertCanManage(ctx.workspaceId, ctx.actorId, existing.ownerId);
    await Promise.all(existing.secretKeys.map((k) => deleteProcedureSecret(ctx.workspaceId, id, k)));
    await deleteProcedureSchedule(id).catch((err) => console.error("procedure delete: schedule teardown failed", err));
    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: keyOf(ctx.workspaceId, id) }));
    await emit(ctx, "procedure.deleted", { procedureId: id });
    return c.json({ deleted: true as const });
  },
);

/* ─────────────────────────── Secrets (write-only) ─────────────────────────── */

proceduresApp.openapi(
  createRoute({
    method: "put",
    path: "/{procedureId}/secrets/{key}",
    request: {
      params: z.object({ procedureId, key: z.string().min(1) }),
      body: { content: { "application/json": { schema: z.object({ value: z.string().min(1) }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.putProcedureSecretOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { procedureId: id, key } = c.req.valid("param");
    const { value } = c.req.valid("json");
    const existing = await loadProcedure(ctx.workspaceId, id);
    await assertCanManage(ctx.workspaceId, ctx.actorId, existing.ownerId);
    await putProcedureSecret(ctx.workspaceId, id, key, value);
    if (!existing.secretKeys.includes(key)) {
      const updated = procedureSchema.parse({ ...existing, secretKeys: [...existing.secretKeys, key], updatedAt: new Date().toISOString() });
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...keyOf(ctx.workspaceId, id), procedure: updated } }));
    }
    await emit(ctx, "procedure.updated", { procedureId: id, secret: key });
    return c.json({ stored: true as const });
  },
);

proceduresApp.openapi(
  createRoute({
    method: "delete",
    path: "/{procedureId}/secrets/{key}",
    request: { params: z.object({ procedureId, key: z.string().min(1) }) },
    responses: { 200: { content: { "application/json": { schema: contract.deleteProcedureSecretOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { procedureId: id, key } = c.req.valid("param");
    const existing = await loadProcedure(ctx.workspaceId, id);
    await assertCanManage(ctx.workspaceId, ctx.actorId, existing.ownerId);
    await deleteProcedureSecret(ctx.workspaceId, id, key);
    const updated = procedureSchema.parse({
      ...existing,
      secretKeys: existing.secretKeys.filter((k) => k !== key),
      updatedAt: new Date().toISOString(),
    });
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...keyOf(ctx.workspaceId, id), procedure: updated } }));
    await emit(ctx, "procedure.updated", { procedureId: id, secretRemoved: key });
    return c.json({ deleted: true as const });
  },
);

/* ─────────────────────────── Run now ─────────────────────────── */

proceduresApp.openapi(
  createRoute({
    method: "post",
    path: "/{procedureId}/run",
    request: { params: z.object({ procedureId }) },
    responses: { 200: { content: { "application/json": { schema: contract.runProcedureOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { procedureId: id } = c.req.valid("param");
    const procedure = await loadProcedure(ctx.workspaceId, id);
    await assertCanManage(ctx.workspaceId, ctx.actorId, procedure.ownerId);
    const runId = ulid();
    await workflow.start(Resource.AgentRuntime, {
      name: `procedure-${id}-${runId}`,
      payload: {
        kind: "procedure" as const,
        workspaceId: ctx.workspaceId,
        procedureId: id,
        agentId: procedure.agentId,
        runId,
        triggeredBy: "run now",
        actorId: ctx.actorId,
      },
    });
    await emit(ctx, "procedure.run", { procedureId: id });
    return c.json({ runId });
  },
);
