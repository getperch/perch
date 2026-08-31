import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { connectors as contract } from "@perch/api-contract";
import { CONNECTOR_LIST, connectorId, validateConnectorConfig } from "@perch/core";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { deleteConnectorConfig, getConnectorStatus, storeConnectorConfig } from "../connector-config.js";

export const connectorsApp = new OpenAPIHono<AppEnv>();

/** Backs Settings → Connectors: every connector Perch supports, plus this workspace's current
 * config state for each. Secrets are never returned — only the declared non-secret field values. */
connectorsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listConnectorsOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const rows = await Promise.all(
      CONNECTOR_LIST.map(async (d) => {
        const status = await getConnectorStatus(ctx.workspaceId, d.id);
        return {
          id: d.id,
          name: d.name,
          description: d.description,
          docsUrl: d.docsUrl,
          configFields: d.configFields,
          hasPerAgentConnect: d.hasPerAgentConnect,
          configured: status.configured,
          publicValues: status.publicValues,
        };
      }),
    );
    return c.json(rows);
  },
);

const connectorParam = z.object({ connectorId });

/** Enter/update one connector's workspace-level credentials. Keys/values are validated against
 * that connector's declared `configFields` (see @perch/core) — unknown keys are rejected. */
connectorsApp.openapi(
  createRoute({
    method: "put",
    path: "/{connectorId}/config",
    request: {
      params: connectorParam,
      body: { content: { "application/json": { schema: contract.putConnectorConfigInput } } },
    },
    responses: { 200: { content: { "application/json": { schema: contract.putConnectorConfigOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { connectorId: id } = c.req.valid("param");
    const { values } = c.req.valid("json");
    let cleaned: Record<string, string>;
    try {
      cleaned = validateConnectorConfig(id, values);
    } catch (err) {
      throw new HTTPException(400, { message: err instanceof Error ? err.message : "Invalid connector config" });
    }
    await storeConnectorConfig(ctx.workspaceId, id, cleaned);
    return c.json({ configured: true as const });
  },
);

connectorsApp.openapi(
  createRoute({
    method: "get",
    path: "/{connectorId}/status",
    request: { params: connectorParam },
    responses: { 200: { content: { "application/json": { schema: contract.getConnectorStatusOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { connectorId: id } = c.req.valid("param");
    const status = await getConnectorStatus(ctx.workspaceId, id);
    return c.json(status);
  },
);

connectorsApp.openapi(
  createRoute({
    method: "delete",
    path: "/{connectorId}/config",
    request: { params: connectorParam },
    responses: { 200: { content: { "application/json": { schema: contract.deleteConnectorConfigOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { connectorId: id } = c.req.valid("param");
    await deleteConnectorConfig(ctx.workspaceId, id);
    return c.json({ configured: false as const });
  },
);
