import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpClient } from "@strands-agents/sdk";
import type { ToolGrant } from "@perch/core";

// `McpClient#listTools()`'s element type (`McpTool`) isn't itself exported from the SDK's package
// root — only used structurally as a return type — so this derives the same type from the method
// signature instead of importing a class name that doesn't exist at this package's public surface.
export type McpToolInstance = Awaited<ReturnType<McpClient["listTools"]>>[number];

/**
 * `agent-runtime` used to reach every tool through two thin shim Lambdas
 * (services/tools/gateway-caller, services/tools/web-search), each doing its own SigV4-signed MCP
 * client call to a Gateway and getting invoked via `ctx.invoke()` for durable-execution
 * checkpointing. Both shims are gone — `@strands-agents/sdk`'s `Agent` can take `McpTool` instances
 * straight from `McpClient.listTools()` as its `tools` list, so this module builds one `McpClient`
 * directly here and hands its tools to the agent loop. The `ctx.invoke()` checkpoint-per-tool-call
 * durability this trades away is a deliberate, accepted tradeoff — approval-gating (the
 * safety-critical part) is fully preserved via `ApprovalInterventionHandler` (see tools.ts), which
 * still uses `ctx.createCallback()` exactly as before.
 *
 * One Gateway, not two: it used to be one Gateway per region (ap-southeast-2 for the 4 Lambda
 * tools, us-east-1 for the AWS-managed Web Search connector), merged into a single us-east-1
 * Gateway — see infra/gateway.ts's file comment for why us-east-1 specifically (Web Search's
 * region restriction, plus the newly-confirmed-live fact that Gateway can only front Lambdas in
 * its own region, forced the 4 tool Lambdas to move rather than the Gateway).
 *
 * The SigV4-signing `makeSignedFetch` below is ported as-is from
 * services/tools/gateway-caller/src/handler.ts and services/tools/web-search/src/handler.ts (both
 * proven, live-tested this session) — Gateway requires every request to be SigV4-signed (service
 * `bedrock-agentcore`), which neither `McpClient` nor `StreamableHTTPClientTransport` has built-in
 * support for, so this plugs a signing `fetch` into the transport's `fetch` option instead.
 */
function makeSignedFetch(region: string): FetchLike {
  const signer = new SignatureV4({
    service: "bedrock-agentcore",
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    const headers: Record<string, string> = { host: url.hostname };
    if (init.headers) new Headers(init.headers).forEach((value, key) => (headers[key] = value));

    const body = typeof init.body === "string" ? init.body : undefined;

    const request = new HttpRequest({
      method: init.method ?? "GET",
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers,
      body,
    });

    const signed = await signer.sign(request);
    return fetch(url, {
      method: signed.method,
      headers: signed.headers as Record<string, string>,
      body: signed.body as string | undefined,
    });
  };
}

// The one Gateway (infra/gateway.ts's makeGateway()) fronting http_fetch/gmail/calendar/browser as
// `lambda`-type targets, and AWS's managed Web Search connector. Gateway prefixes every registered
// tool's name with its target's own `name` as `${targetName}___${toolName}` when exposing it over
// MCP — see infra/gateway.ts's file comment. TOOL_TARGETS must match infra/gateway.ts's own
// TOOL_TARGETS map exactly — there's no shared package between infra/ and services/agent-runtime to
// import it from (same "duplicate deliberately, keep in sync" convention used throughout this repo,
// previously documented in the now-deleted services/agent-runtime/src/tool-specs.ts's file comment).
const TOOL_TARGETS: Record<string, string> = {
  http_fetch: "http-fetch",
  gmail: "gmail",
  calendar: "calendar",
  browser: "browser",
};

// Confirmed live via a real `tools/list` call this session that the Web Search connector's single
// tool is exposed as "web-search-tool___WebSearch", not the bare "WebSearch" an earlier (wrong)
// attempt assumed — see infra/gateway.ts's file comment for the full story.
const WEB_SEARCH_QUALIFIED_TOOL_NAME = "web-search-tool___WebSearch";

// AWS's Web Search connector target sets no description at all — confirmed live via a raw
// `tools/list` call: the tool comes back with no `description` key. `McpClient.listTools()` (see
// `@strands-agents/sdk`'s mcp/client.js) falls back to a generic `Tool which performs
// ${toolSpec.name}` in that case, which the model actually saw as "Tool which performs
// web-search-tool___WebSearch" — no semantic signal that this searches the web, unlike the 4
// Lambda tools' rich, hand-authored descriptions (infra/gateway.ts). That's the confirmed root
// cause of the agent answering from memory instead of calling web_search. AWS gives no way to set
// a real description on a connector target (unlike lambda targets' `toolSchema.inlinePayloads`),
// so this is patched client-side instead — the same "descriptions live in one place we control"
// pattern already used for the 4 Lambda tools, just applied post-hoc since this one tool's
// metadata isn't ours to author at the Gateway layer.
const WEB_SEARCH_DESCRIPTION =
  "Search the web for current information — news, prices, scores, schedules, or anything else " +
  "that could have changed since your training data was collected. Returns a list of results " +
  "with titles, URLs, and snippets. If you already know the exact URL to fetch, use http_fetch " +
  "instead.";

/**
 * `McpTool`'s `description`/`toolSpec` are `readonly` in the SDK's TS types (and `McpTool` itself
 * isn't exported from the package root, so there's no way to construct a replacement instance) —
 * but neither is frozen at runtime, so this overwrites them directly via a cast. `tool.toolSpec`,
 * not `tool.description`, is what actually reaches the model (see `Agent`'s
 * `this._toolRegistry.list().map((tool) => tool.toolSpec)` in agent.js) — both are set here to
 * keep them consistent with each other.
 */
function overrideToolDescription(tool: McpToolInstance, description: string): void {
  const mutable = tool as unknown as { description: string; toolSpec: { description: string } };
  mutable.description = description;
  mutable.toolSpec = { ...mutable.toolSpec, description };
}

const GATEWAY_REGION = "us-east-1";

/**
 * Tools with no Gateway target at all — offered in the desktop app's tool picker
 * (apps/desktop/src/App.tsx's DEFAULT_TOOLS) but never wired to any backend. Granting one of these
 * should fail clearly and immediately, not be silently dropped from the agent's tool list.
 */
function assertHasGatewayTarget(toolName: string): void {
  if (toolName === "web_search" || TOOL_TARGETS[toolName]) return;
  throw new Error(`no Gateway target found for tool "${toolName}" (see infra/gateway.ts)`);
}

export type ResolvedTools = {
  tools: McpToolInstance[];
  grantsByToolName: Map<string, ToolGrant>;
  /** Disconnects the MCP client — call this in a `finally` once the run completes or fails,
   * mirroring the `try/finally` `client.disconnect()` pattern the deleted shim Lambdas used. */
  disconnect: () => Promise<void>;
};

/**
 * Connects to the Gateway, lists its tools, and resolves each granted `ToolGrant` to its matching
 * `McpTool` — plus a lookup from each tool's qualified MCP name back to the `ToolGrant` it came
 * from, which `ApprovalInterventionHandler` (tools.ts) needs to check `needsApproval` from inside
 * `beforeToolCall`, where all it has is the bare tool-use name.
 *
 * Skips connecting entirely when `grants` is empty (e.g. an agent with no tools configured) —
 * agents without any tool grants shouldn't need `TOOL_GATEWAY_URL` set at all.
 */
export async function resolveGrantedTools(grants: ToolGrant[]): Promise<ResolvedTools> {
  if (grants.length === 0) {
    return { tools: [], grantsByToolName: new Map(), disconnect: async () => {} };
  }

  for (const grant of grants) assertHasGatewayTarget(grant.toolName);

  const gatewayUrl = process.env.TOOL_GATEWAY_URL ?? "";
  if (!gatewayUrl) throw new Error("TOOL_GATEWAY_URL is not set");

  const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl), { fetch: makeSignedFetch(GATEWAY_REGION) });
  const client = new McpClient({ transport });

  const disconnect = async () => {
    await client.disconnect();
  };

  try {
    await client.connect();
    const gatewayTools = await client.listTools();

    const tools: McpToolInstance[] = [];
    const grantsByToolName = new Map<string, ToolGrant>();

    for (const grant of grants) {
      const qualifiedName = grant.toolName === "web_search" ? WEB_SEARCH_QUALIFIED_TOOL_NAME : `${TOOL_TARGETS[grant.toolName]}___${grant.toolName}`;
      const tool = gatewayTools.find((t) => t.name === qualifiedName);
      if (!tool) {
        throw new Error(`Gateway has no tool named "${qualifiedName}" (available: ${gatewayTools.map((t) => t.name).join(", ") || "none"})`);
      }
      if (grant.toolName === "web_search") overrideToolDescription(tool, WEB_SEARCH_DESCRIPTION);
      tools.push(tool);
      grantsByToolName.set(tool.name, grant);
    }

    return { tools, grantsByToolName, disconnect };
  } catch (err) {
    await disconnect();
    throw err;
  }
}
