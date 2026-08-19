import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { humanActor, type Member, type OkfConcept } from "@perch/core";
import { knowledge as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { emit } from "../events.js";
import {
  assertCuratedPath,
  deprecateConcept,
  listConcepts,
  readConcept,
  rebuildIndex,
  verifyConcept,
  writeConcept,
} from "../okf-store.js";

/**
 * `/knowledge/*` — the human window onto the workspace's OKF knowledge bundle (see
 * services/api/src/okf-store.ts): browse every concept, read one, curate `<domain>/` docs, mark a
 * fact human-verified, rebuild the index.
 *
 * Writes are restricted to workspace owners/admins: a curated doc is markdown that agents then pull
 * into their model context via `search_memory` / injection, so it is a prompt-injection surface —
 * `assertAdmin` is the one line to relax if a workspace wants any member to contribute.
 */
export const knowledgeApp = new OpenAPIHono<AppEnv>();

async function assertAdmin(workspaceId: string, actorId: string): Promise<void> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${actorId}` } }));
  const member: Member | undefined = res.Item?.member;
  if (!member || member.kind !== "person" || (member.role !== "owner" && member.role !== "admin")) {
    throw new HTTPException(403, { message: "only a workspace owner or admin can change workspace knowledge" });
  }
}

async function assertMember(workspaceId: string, actorId: string): Promise<Member> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${workspaceId}`, sk: `MEMBER#${actorId}` } }));
  const member: Member | undefined = res.Item?.member;
  if (!member || member.kind !== "person") throw new HTTPException(403, { message: "not a member of this workspace" });
  return member;
}

const asResponse = (path: string, concept: OkfConcept) => ({ path, frontmatter: concept.frontmatter, body: concept.body });

knowledgeApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listOutput } }, description: "OK" } },
  }),
  async (c) => {
    const concepts = await listConcepts(c.get("workspaceId"));
    return c.json({ concepts });
  },
);

knowledgeApp.openapi(
  createRoute({
    method: "get",
    path: "/doc",
    request: { query: contract.getInput },
    responses: { 200: { content: { "application/json": { schema: contract.getOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { path } = c.req.valid("query");
    const concept = await readConcept(c.get("workspaceId"), path).catch((err) => {
      throw new HTTPException(400, { message: (err as Error).message });
    });
    if (!concept) throw new HTTPException(404, { message: `no knowledge doc at "${path}"` });
    return c.json(asResponse(path, concept));
  },
);

knowledgeApp.openapi(
  createRoute({
    method: "put",
    path: "/doc",
    request: { body: { content: { "application/json": { schema: contract.putInput } } } },
    responses: { 200: { content: { "application/json": { schema: contract.putOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    await assertAdmin(ctx.workspaceId, ctx.actorId);
    const input = c.req.valid("json");
    try {
      assertCuratedPath(input.path);
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }

    const existing = await readConcept(ctx.workspaceId, input.path);
    const now = new Date().toISOString();
    const concept: OkfConcept = {
      frontmatter: {
        ...(existing?.frontmatter ?? {}),
        type: input.type,
        title: input.title,
        description: input.description,
        tags: input.tags ?? existing?.frontmatter.tags ?? [],
        status: input.status ?? existing?.frontmatter.status ?? "stable",
        stale_after: input.staleAfter ?? existing?.frontmatter.stale_after,
        generated: existing?.frontmatter.generated ?? { by: humanActor(ctx.actorId), at: now },
      },
      body: input.body,
    };

    await writeConcept(
      ctx.workspaceId,
      input.path,
      concept,
      existing ? "Update" : "Creation",
      `${input.path} — ${input.title}`,
    );
    await emit(ctx, existing ? "knowledge.updated" : "knowledge.created", { path: input.path });
    return c.json(asResponse(input.path, concept));
  },
);

knowledgeApp.openapi(
  createRoute({
    method: "delete",
    path: "/doc",
    request: { body: { content: { "application/json": { schema: contract.deleteInput } } } },
    responses: { 200: { content: { "application/json": { schema: contract.deleteOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    await assertAdmin(ctx.workspaceId, ctx.actorId);
    const { path } = c.req.valid("json");
    const concept = await deprecateConcept(ctx.workspaceId, path).catch((err) => {
      throw new HTTPException(404, { message: (err as Error).message });
    });
    await emit(ctx, "knowledge.deprecated", { path });
    return c.json(asResponse(path, concept));
  },
);

knowledgeApp.openapi(
  createRoute({
    method: "post",
    path: "/verify",
    request: { body: { content: { "application/json": { schema: contract.verifyInput } } } },
    responses: { 200: { content: { "application/json": { schema: contract.verifyOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    await assertMember(ctx.workspaceId, ctx.actorId);
    const { path } = c.req.valid("json");
    const concept = await verifyConcept(ctx.workspaceId, path, humanActor(ctx.actorId)).catch((err) => {
      throw new HTTPException(404, { message: (err as Error).message });
    });
    await emit(ctx, "knowledge.verified", { path });
    return c.json(asResponse(path, concept));
  },
);

knowledgeApp.openapi(
  createRoute({
    method: "post",
    path: "/reindex",
    responses: { 200: { content: { "application/json": { schema: contract.reindexOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    await assertAdmin(ctx.workspaceId, ctx.actorId);
    const indexed = await rebuildIndex(ctx.workspaceId);
    return c.json({ indexed });
  },
);
