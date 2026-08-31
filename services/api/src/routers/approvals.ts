import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { approvalId } from "@perch/core";
import { approvals as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { appendChannelEvent, emit } from "../events.js";
import { resolveDurableCallback } from "../durable-callback.js";

export const approvalsApp = new OpenAPIHono<AppEnv>();

approvalsApp.openapi(
  createRoute({
    method: "post",
    path: "/{approvalId}/resolve",
    request: {
      params: z.object({ approvalId }),
      body: { content: { "application/json": { schema: contract.resolveApprovalInput.omit({ approvalId: true }) } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.resolveApprovalOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { approvalId: id } = c.req.valid("param");
    const { decision } = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `APPROVAL#${id}` } }));
    if (!existing.Item) throw new HTTPException(404, { message: `approval ${id} not found` });
    const approval = {
      ...existing.Item.approval,
      status: decision,
      resolvedById: ctx.actorId,
      resolvedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `APPROVAL#${id}`, approval } }));
    await appendChannelEvent(approval.channelId, { type: "approval.updated", channelId: approval.channelId, approval });
    await emit(ctx, decision === "approved" ? "approval.approved" : "approval.denied", { approvalId: id, runId: approval.runId });

    // Resumes the paused agent-runtime Lambda — see services/agent-runtime's use of
    // DurableContext.callback() for the tool call this approval gates.
    await resolveDurableCallback(approval.callbackToken, { decision });

    return c.json(approval);
  },
);
