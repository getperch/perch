import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { agentToPlugin, member as memberSchema, pluginIndex, pluginManifest, type PluginIndexEntry } from "@perch/core";
import { plugins as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";
import { ctxOf } from "../context.js";
import { ddb, TABLE_NAME } from "../db.js";
import { readCapped, safeFetch } from "../ssrf-guard.js";

const s3 = new S3Client({});
const BUCKET_NAME = process.env.AGENT_PLUGINS_BUCKET_NAME ?? "";
const INDEX_KEY = "plugins/index.json";

async function readIndex(): Promise<PluginIndexEntry[]> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: INDEX_KEY }));
    const body = await res.Body!.transformToString();
    return pluginIndex.parse(JSON.parse(body));
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return [];
    throw err;
  }
}

async function putJson(key: string, value: unknown) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json",
    }),
  );
}

function bumpPatch(version: string) {
  const parts = version.split(".");
  const patch = Number(parts[2] ?? 0) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

export const pluginsApp = new OpenAPIHono<AppEnv>();

/** "Publish as plugin" on the agent detail screen — packages the agent's current config. */
pluginsApp.openapi(
  createRoute({
    method: "post",
    path: "/publish",
    request: { body: { content: { "application/json": { schema: contract.publishInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.publishOutput } }, description: "OK" } },
  }),
  async (c) => {
    const ctx = ctxOf(c);
    const { memberId } = c.req.valid("json");
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `WORKSPACE#${ctx.workspaceId}`, sk: `MEMBER#${memberId}` } }));
    if (!existing.Item || existing.Item.member.kind !== "agent") throw new HTTPException(404, { message: `agent ${memberId} not found` });
    // Backfills any zod-defaulted AgentConfig field (e.g. `skills`) this agent predates and
    // therefore doesn't actually have stored — see services/api/src/routers/members.ts's
    // normalizeMember for the full explanation. Without this, agentToPlugin's `agent.config.skills`
    // access throws for any agent created before that field existed.
    const agent = memberSchema.parse(existing.Item.member);
    if (agent.kind !== "agent") throw new HTTPException(404, { message: `agent ${memberId} not found` });

    let draft: ReturnType<typeof agentToPlugin>;
    try {
      draft = agentToPlugin(agent);
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }

    const index = await readIndex();
    const prior = index.find((e) => e.name === draft.manifest.name);
    const version = prior ? bumpPatch(prior.version) : "1.0.0";
    const { manifest, skillMarkdown, additionalSkillMarkdown } = agentToPlugin(agent, { version });

    const prefix = `plugins/${manifest.name}/${version}`;
    await putJson(`${prefix}/plugin.json`, manifest);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${prefix}/skills/${manifest.name}/SKILL.md`,
        Body: skillMarkdown,
        ContentType: "text/markdown",
      }),
    );
    await Promise.all(
      Object.entries(additionalSkillMarkdown).map(([skillName, body]) =>
        s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${prefix}/skills/${skillName}/SKILL.md`, Body: body, ContentType: "text/markdown" })),
      ),
    );

    const entry: PluginIndexEntry = {
      name: manifest.name,
      version,
      description: manifest.description,
      publishedAt: new Date().toISOString(),
      publishedBy: ctx.actorId,
    };
    await putJson(INDEX_KEY, [...index.filter((e) => e.name !== manifest.name), entry]);

    return c.json({ name: manifest.name, version });
  },
);

/** "Browse plugins" in the Add member -> Agent screen. */
pluginsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: z.object({ q: z.string().optional() }) },
    responses: { 200: { content: { "application/json": { schema: contract.listOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { q } = c.req.valid("query");
    const index = await readIndex();
    if (!q) return c.json(index);
    const needle = q.toLowerCase();
    const matches = index.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        (e.description?.toLowerCase().includes(needle) ?? false) ||
        (e.keywords?.some((k) => k.toLowerCase().includes(needle)) ?? false),
    );
    return c.json(matches);
  },
);

pluginsApp.openapi(
  createRoute({
    method: "get",
    path: "/{name}/{version}",
    request: { params: z.object({ name: z.string(), version: z.string() }) },
    responses: { 200: { content: { "application/json": { schema: contract.getOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { name, version } = c.req.valid("param");
    const prefix = `plugins/${name}/${version}`;
    const manifestRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${prefix}/plugin.json` }));
    const manifest = pluginManifest.parse(JSON.parse(await manifestRes.Body!.transformToString()));
    const skillRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${prefix}/skills/${name}/SKILL.md` }));
    const skillMarkdown = await skillRes.Body!.transformToString();

    const additionalSkills: Record<string, string> = {};
    await Promise.all(
      (manifest.skills ?? []).map(async (skillName) => {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${prefix}/skills/${skillName}/SKILL.md` }));
        additionalSkills[skillName] = await res.Body!.transformToString();
      }),
    );

    return c.json({ manifest, skillMarkdown, additionalSkills });
  },
);

/**
 * Turns whatever a user pasted into the URL of a `plugin.json`, so they can hand us a normal
 * GitHub page rather than hunting for the raw path. Accepts:
 *   - a GitHub repo or dir page: https://github.com/{owner}/{repo}[/tree/{ref}[/{path}]]
 *   - a GitHub file link:        https://github.com/{owner}/{repo}/blob/{ref}/{path}/plugin.json
 *   - a direct raw file:         https://…/plugin.json
 *   - a directory on any host:   https://…/some/dir  (→ https://…/some/dir/plugin.json)
 * SKILL.md files are then fetched relative to whatever this returns (see the import route).
 */
export function resolvePluginManifestUrl(input: string): URL {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" is not a valid URL`);
  }

  if (u.hostname === "github.com" || u.hostname === "www.github.com") {
    const [owner, repo, kind, ref, ...rest] = u.pathname.split("/").filter(Boolean);
    if (!owner || !repo) {
      throw new Error("expected a GitHub URL like https://github.com/owner/repo or …/tree/main/path");
    }
    // Bare repo → default branch (raw resolves `HEAD` to it), manifest at the repo root.
    if (!kind) return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/plugin.json`);
    if (kind !== "tree" && kind !== "blob") {
      throw new Error(`can't import from a GitHub "${kind}" URL — link the repo, or a /tree/<branch>/<path>`);
    }
    const path = rest.join("/");
    // /blob/ always names a file; if it's the manifest itself, use it directly.
    if (kind === "blob" && path.toLowerCase().endsWith(".json")) {
      return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`);
    }
    return new URL("plugin.json", `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path ? `${path}/` : ""}`);
  }

  // Non-GitHub: a direct .json is taken as-is; anything else is treated as a directory.
  if (u.pathname.toLowerCase().endsWith(".json")) return u;
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return new URL("plugin.json", u);
}

/**
 * "Import from URL…" in the Add member -> Agent screen's plugin picker — pulls a plugin.json +
 * its SKILL.md from outside this perch instance (e.g. a plugin published by someone else's
 * deployment, a GitHub repo, or a plain agent-plugins.org registry). The URL the caller supplies
 * is fetched server-side, so ssrf-guard's baseline hardening (https-only, no private/link-local
 * targets, capped size, redirect limit) is the security boundary here.
 */
pluginsApp.openapi(
  createRoute({
    method: "post",
    path: "/import",
    request: { body: { content: { "application/json": { schema: contract.importInput.omit({ workspaceId: true }) } } } },
    responses: { 200: { content: { "application/json": { schema: contract.importOutput } }, description: "OK" } },
  }),
  async (c) => {
    const { url } = c.req.valid("json");

    let manifestUrl: URL;
    try {
      manifestUrl = resolvePluginManifestUrl(url);
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }

    try {
      const manifestRes = await safeFetch(manifestUrl.toString());
      if (!manifestRes.ok) throw new Error(`fetching plugin.json failed: ${manifestRes.status}`);
      const manifest = pluginManifest.parse(JSON.parse(await readCapped(manifestRes)));

      const skillUrl = new URL(`skills/${manifest.name}/SKILL.md`, manifestUrl);
      const skillRes = await safeFetch(skillUrl.toString());
      if (!skillRes.ok) throw new Error(`fetching SKILL.md failed: ${skillRes.status}`);
      const skillMarkdown = await readCapped(skillRes);

      const additionalSkills: Record<string, string> = {};
      for (const skillName of manifest.skills ?? []) {
        const res = await safeFetch(new URL(`skills/${skillName}/SKILL.md`, manifestUrl).toString());
        if (!res.ok) throw new Error(`fetching skills/${skillName}/SKILL.md failed: ${res.status}`);
        additionalSkills[skillName] = await readCapped(res);
      }

      return c.json({ manifest, skillMarkdown, additionalSkills });
    } catch (err) {
      throw new HTTPException(400, { message: `could not import plugin from "${url}": ${(err as Error).message}` });
    }
  },
);
