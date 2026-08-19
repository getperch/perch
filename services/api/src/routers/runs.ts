import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { runId } from "@fizz/core";
import { runs as contract } from "@fizz/api-contract";
import type { AppEnv } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";

export const runsApp = new OpenAPIHono<AppEnv>();

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
