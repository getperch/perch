/// <reference path="../.sst/platform/config.d.ts" />
import path from "node:path";
import * as command from "@pulumi/command";

/**
 * The single Bedrock AgentCore Gateway for every tool this app has — http_fetch/gmail/calendar/
 * browser as `lambda`-type MCP targets, plus AWS's managed Web Search connector. `services/
 * agent-runtime` (see its `mcp-gateways.ts`) talks native MCP straight to this one Gateway via
 * `@strands-agents/sdk`'s `McpClient` — no shim Lambda in between (there used to be one,
 * services/tools/gateway-caller, removed once agent-runtime started connecting directly).
 *
 * ## Why this Gateway lives in us-east-1, not the app's home region (ap-southeast-2)
 *
 * This used to be two separate Gateways in two separate regions, because of two independent,
 * both-confirmed-live region restrictions that only overlap in one direction:
 *
 * 1. **Web Search connector is region-restricted.** Verified live with a raw SigV4-signed HTTP
 *    POST straight to `https://bedrock-agentcore-control.us-east-1.amazonaws.com/gateways/
 *    {gatewayId}/targets/` (bypassing the AWS CLI/SDK's client-side parameter validation, which
 *    at the time rejected the `connector` field entirely — see "The connector CLI-staleness
 *    story" below):
 *    ```
 *    POST body:
 *    {
 *      "name": "web-search-tool-rawtest",
 *      "targetConfiguration": {
 *        "mcp": { "connector": { "source": { "connectorId": "web-search", "version": "1.2.0" },
 *          "configurations": [{ "name": "WebSearch", "parameterValues": {} }] } }
 *      },
 *      "credentialProviderConfigurations": [{ "credentialProviderType": "GATEWAY_IAM_ROLE" }]
 *    }
 *    ```
 *    Response: `HTTP 202`, target reached `status: "READY"` within 5 seconds in us-east-1. The
 *    identical request against a Gateway in ap-southeast-2 got a clean `HTTP 400
 *    {"message":"Connector integration web-search is not available for this account."}` — a real
 *    business-logic rejection, confirming the documented region restriction (Web Search only in
 *    `us-east-1`, `eu-west-1`, `ap-northeast-1`) is real and current.
 *
 * 2. **`lambda`-type targets are ALSO region-locked — to the Gateway's own region, not the
 *    Lambda's.** Confirmed live while planning this consolidation: created a test target on the
 *    (then-separate) us-east-1 Web Search Gateway pointing at the real, deployed ap-southeast-2
 *    `ToolGmail` Lambda's ARN, and got `ValidationException: Lambda function not found:
 *    arn:aws:lambda:ap-southeast-2:...` — the control plane looks the Lambda up in the Gateway's
 *    *own* region and doesn't find it there, even though the ARN is valid and the function
 *    genuinely exists in ap-southeast-2. So a Gateway can only front Lambdas that live in the
 *    same region as the Gateway itself.
 *
 * Combined: Web Search only works in 3 regions, none of which is this app's home region, and
 * Gateway can't front cross-region Lambdas — so getting to *one* Gateway means the Lambda side
 * has to move to match Web Search's side, not the other way around. Hence `toolsProvider` below:
 * `http-fetch`/`gmail`/`calendar`/`browser` (see infra/api.ts) all deploy to us-east-1 via this
 * aliased provider, even though the rest of the app (auth, DB, services/api, AgentRuntime) stays
 * in the app's home region. `gmail`/`calendar`/`browser`'s own AWS SDK clients (SSM, DynamoDB,
 * BedrockAgentCoreClient) are explicitly pinned back to the home region via a `HOME_REGION` env
 * var (see their source) — none of the state those calls touch (OAuth tokens, the workspace
 * table, the AgentCore Browser control-plane resource) is moving, only the Lambdas' own compute
 * region is.
 *
 * ## The connector CLI-staleness story (why the Web Search target is a raw HTTP call, not
 * `aws.bedrock.AgentcoreGatewayTarget`)
 *
 * A previous attempt at the Web Search target used `aws bedrock-agentcore-control
 * create-gateway-target` (both the raw AWS CLI and Pulumi's native `aws.bedrock.
 * AgentcoreGatewayTarget` resource) with a `targetConfiguration.mcp.connector` field. Both
 * rejected it client-side: `Unknown parameter in targetConfiguration.mcp: "connector", must be
 * one of: openApiSchema, smithyModel, lambda, mcpServer, apiGateway`. That was wrongly taken as
 * proof the connector target type doesn't exist in the live API. **That conclusion was wrong**:
 * the AWS CLI's bundled botocore service model for `bedrock-agentcore-control` (and,
 * independently, `@pulumi/aws`'s generated TypeScript types for the same field) are stale — both
 * reject the request purely client-side, before ever making a network call, regardless of what
 * the live service actually accepts. Same class of staleness already hit once before this
 * session with `InvokeCodeInterpreter` (present in the JS SDK, absent from the CLI). Verified
 * live per point 1 above. If this needs touching again and something looks unsupported, don't
 * trust `aws bedrock-agentcore-control create-gateway-target help`'s parameter list as evidence —
 * verify against the live API with a raw signed request first.
 *
 * Because of this, the Web Search target is created out-of-band via a `command.local.Command`
 * that shells out to a small standalone Node script (infra/scripts/agentcore-connector-target.mjs)
 * which does its own SigV4 signing and POSTs directly to the control-plane endpoint — exactly the
 * mechanism verified above. The Gateway resource itself (`aws.bedrock.AgentcoreGateway`) and the 4
 * `lambda`-type targets are unaffected by any of this and use normal, fully-supported Pulumi
 * resources.
 *
 * ## Tool naming
 *
 * Gateway prefixes every registered tool's name with its target's own `name` as
 * `${targetName}___${toolName}` when exposing it over MCP (see AWS's Lambda-target docs, "Lambda
 * function input format") — confirmed this applies to connector targets too, not just Lambda
 * targets as AWS's docs implied: a live `tools/list` call against the deployed Web Search target
 * showed its tool exposed as `"web-search-tool___WebSearch"`, not the bare `"WebSearch"` an
 * earlier (wrong) attempt assumed. `TOOL_TARGETS` below is the single source of truth for each
 * Lambda tool's target name; `WEB_SEARCH_QUALIFIED_TOOL_NAME` in services/agent-runtime/src/
 * mcp-gateways.ts hardcodes the Web Search one. There's no shared package between infra and
 * services/agent-runtime to import either from — duplicated deliberately, keep in sync (same
 * convention used throughout this repo).
 *
 * Each Lambda target's `toolSchema` is a hand-rolled AWS JSON-Schema-ish literal (the shape
 * `aws.bedrock.AgentcoreGatewayTarget`'s `targetConfiguration.mcp.lambda.toolSchema.inlinePayloads`
 * expects — an array of `{name, type, description}` properties, not real JSON Schema; notably no
 * `enum`/`oneOf` support, so the 2 discriminated-union tools (gmail, calendar) are flattened into
 * one object exposing every branch's fields as optional, with the `action` field's description
 * listing the allowed literal values instead of an enum constraint). This registration is the
 * *only* place these tools' descriptions/schemas live — there used to be a second, model-facing
 * copy in services/agent-runtime/src/tool-specs.ts, kept in sync by hand; that file is gone, so
 * whatever's written here is verbatim what the model sees. No `zod-to-json-schema`-style dependency
 * exists anywhere in this repo already, and these 4 schemas are small/enumerable enough that
 * hand-rolling them here beats adding one just for this.
 */
export const TOOL_TARGETS: Record<string, string> = {
  http_fetch: "http-fetch",
  gmail: "gmail",
  calendar: "calendar",
  browser: "browser",
};

const GATEWAY_REGION = "us-east-1";

/** All 4 tool Lambdas (infra/api.ts) deploy via this provider so they live in the same region as
 * this Gateway — see this file's header comment for why that's required, not optional. */
export const toolsProvider = new aws.Provider("ToolsUsEast1", { region: GATEWAY_REGION });

// Resolved to an absolute path at Pulumi-program build time. Two things this deliberately does
// NOT do, both tried and confirmed wrong:
//   - A bare path relative to "infra/" (`"infra/scripts/agentcore-connector-target.mjs"`) failed
//     during a real deploy — this script runs fine standalone from the repo root, so SST's actual
//     execution CWD for `local.Command` isn't reliably the repo root the way `pnpm sst:deploy`
//     itself is invoked from.
//   - Resolving via `fileURLToPath(new URL(..., import.meta.url))` from *this* file also failed —
//     the error surfaced an absolute path under `.sst/platform/scripts/...`, proving SST
//     transpiles/bundles `infra/*.ts` into `.sst/platform` before executing it, so this file's own
//     `import.meta.url` at run time points at that bundled copy, not the real source tree (which
//     has no `scripts/` directory alongside it there).
// What actually works: `.sst/platform/src/auto/run.ts` calls `process.chdir($cli.paths.root)`
// before running the Pulumi program at all — confirmed by reading that file directly — so by the
// time this module's top-level code runs, `process.cwd()` is already the real repo root. `$cli`
// itself isn't part of the ambient globals typed for `infra/*.ts` (unlike `$interpolate`/`aws`/
// `$app`), so `process.cwd()` is what's actually usable here, not `$cli.paths.root` directly.
const CONNECTOR_TARGET_SCRIPT = path.join(process.cwd(), "infra/scripts/agentcore-connector-target.mjs");

const WEB_SEARCH_CONNECTOR_ID = "web-search";
const WEB_SEARCH_CONNECTOR_VERSION = "1.2.0";
const WEB_SEARCH_TARGET_NAME = "web-search-tool";

// AWS-owned literal ARN for the Web Search connector's underlying tool — same in every account,
// used for the `bedrock-agentcore:InvokeWebSearch` IAM grant below and re-exported for
// infra/api.ts to grant directly to agentRuntime.
export const WEB_SEARCH_TOOL_ARN = `arn:aws:bedrock-agentcore:${GATEWAY_REGION}:aws:tool/web-search.v1`;

type ToolInputSchema = NonNullable<
  aws.types.input.bedrock.AgentcoreGatewayTargetTargetConfigurationMcpLambdaToolSchemaInlinePayload["inputSchema"]
>;

const httpFetchInputSchema: ToolInputSchema = {
  type: "object",
  description: "Arguments for the http_fetch tool",
  properties: [
    { name: "url", type: "string", required: true, description: "The exact URL to fetch" },
    { name: "method", type: "string", description: '"GET" or "HEAD" — defaults to "GET"' },
  ],
};

const gmailInputSchema: ToolInputSchema = {
  type: "object",
  description: "Arguments for the gmail tool — fields apply only to the action named in their description",
  properties: [
    { name: "action", type: "string", required: true, description: 'One of "list_messages", "get_message", "send"' },
    { name: "query", type: "string", description: 'list_messages only — Gmail search syntax, e.g. "is:unread from:boss@co.com"' },
    { name: "maxResults", type: "integer", description: "list_messages only — max results, 1-50, defaults to 10" },
    { name: "messageId", type: "string", description: "get_message only — the message id to fetch" },
    { name: "to", type: "string", description: "send only — recipient email address" },
    { name: "subject", type: "string", description: "send only — email subject" },
    { name: "body", type: "string", description: "send only — email body text" },
  ],
};

const calendarInputSchema: ToolInputSchema = {
  type: "object",
  description: "Arguments for the calendar tool — fields apply only to the action named in their description",
  properties: [
    { name: "action", type: "string", required: true, description: 'One of "list_events", "create_event"' },
    { name: "timeMinIso", type: "string", description: "list_events only — ISO datetime, defaults to now" },
    { name: "timeMaxIso", type: "string", description: "list_events only — ISO datetime" },
    { name: "maxResults", type: "integer", description: "list_events only — max results, 1-50, defaults to 10" },
    { name: "summary", type: "string", description: "create_event only — event title" },
    { name: "startIso", type: "string", description: "create_event only — ISO datetime" },
    { name: "endIso", type: "string", description: "create_event only — ISO datetime" },
    { name: "description", type: "string", description: "create_event only — event description" },
    {
      name: "attendeeEmails",
      type: "array",
      description: "create_event only — attendee email addresses",
      items: { type: "string" },
    },
  ],
};

const browserInputSchema: ToolInputSchema = {
  type: "object",
  description: "Arguments for the browser tool — fields apply only to the action named in their description",
  properties: [
    { name: "action", type: "string", required: true, description: 'One of "navigate", "click", "type", "screenshot", "extract_text"' },
    { name: "url", type: "string", description: "navigate only — URL to load" },
    { name: "selector", type: "string", description: "click/type/extract_text — CSS selector" },
    { name: "text", type: "string", description: "type only — text to type" },
  ],
};

export function makeGateway(args: {
  toolHttpFetch: sst.aws.Function;
  toolGmail: sst.aws.Function;
  toolCalendar: sst.aws.Function;
  toolBrowser: sst.aws.Function;
}) {
  const { toolHttpFetch, toolGmail, toolCalendar, toolBrowser } = args;
  const accountId = aws.getCallerIdentityOutput({}).accountId;
  // Wildcard on purpose: this also becomes the RoleTrust policy's aws:SourceArn condition below,
  // so it can't reference the gateway's own (not-yet-known) id without a dependency cycle.
  const gatewayArnPattern = $interpolate`arn:aws:bedrock-agentcore:${GATEWAY_REGION}:${accountId}:gateway/*`;

  // Service role the Gateway itself assumes — both to be assumed by bedrock-agentcore (trust
  // policy below), and to actually invoke each tool Lambda it fronts plus the Web Search tool.
  const gatewayRole = new aws.iam.Role("GatewayRole", {
    assumeRolePolicy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "bedrock-agentcore.amazonaws.com" },
          Action: "sts:AssumeRole",
          Condition: {
            StringEquals: { "aws:SourceAccount": accountId },
            ArnLike: { "aws:SourceArn": gatewayArnPattern },
          },
        },
      ],
    }),
  });

  // AWS's Lambda-target docs/examples don't spell out the exact IAM shape needed for a Gateway's
  // service role to invoke its Lambda targets beyond "the gateway needs permission to invoke your
  // Lambda function" — this mirrors the general AWS-service-invokes-Lambda IAM pattern used
  // elsewhere in this stack. Flagged as an inferred, not directly-documented, shape.
  new aws.iam.RolePolicy(
    "GatewayRolePolicy",
    {
      role: gatewayRole.id,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "InvokeToolLambdas",
            Effect: "Allow",
            Action: "lambda:InvokeFunction",
            Resource: [toolHttpFetch.arn, toolGmail.arn, toolCalendar.arn, toolBrowser.arn],
          },
          { Sid: "InvokeGateway", Effect: "Allow", Action: "bedrock-agentcore:InvokeGateway", Resource: gatewayArnPattern },
          { Sid: "InvokeWebSearch", Effect: "Allow", Action: "bedrock-agentcore:InvokeWebSearch", Resource: WEB_SEARCH_TOOL_ARN },
        ],
      }),
    },
    { provider: toolsProvider },
  );

  const gateway = new aws.bedrock.AgentcoreGateway(
    "Gateway",
    {
      name: "perch-tools",
      protocolType: "MCP",
      // SigV4, not an OAuth/JWT authorizer — matches how agent-runtime calls in (its own execution
      // role's IAM permissions, not a bearer token).
      authorizerType: "AWS_IAM",
      roleArn: gatewayRole.arn,
    },
    { dependsOn: [gatewayRole], provider: toolsProvider },
  );

  function makeTarget(resourceName: string, toolName: string, lambdaArn: $util.Input<string>, description: string, inputSchema: ToolInputSchema) {
    return new aws.bedrock.AgentcoreGatewayTarget(
      resourceName,
      {
        name: TOOL_TARGETS[toolName],
        gatewayIdentifier: gateway.gatewayId,
        description: `Gateway target for the ${toolName} tool Lambda`,
        // The Gateway's own service role (this file's gatewayRole above) is what actually calls
        // the Lambda — not a separate credential provider — matching the "Lambda Target with
        // Gateway IAM Role" example in the aws.bedrock.AgentcoreGatewayTarget provider docs.
        credentialProviderConfiguration: { gatewayIamRole: {} },
        targetConfiguration: {
          mcp: {
            lambda: {
              lambdaArn,
              toolSchema: {
                inlinePayloads: [{ name: toolName, description, inputSchema }],
              },
            },
          },
        },
      },
      { dependsOn: [gateway], provider: toolsProvider },
    );
  }

  makeTarget(
    "GatewayTargetHttpFetch",
    "http_fetch",
    toolHttpFetch.arn,
    "Fetch the raw content of a specific, already-known URL (GET or HEAD). This does NOT search the web — " +
      "it can only retrieve a page you already have the exact address for. If you don't already know the " +
      "URL, use web_search first to find one.",
    httpFetchInputSchema,
  );
  makeTarget("GatewayTargetGmail", "gmail", toolGmail.arn, "Read and send Gmail from this agent's own connected Google account.", gmailInputSchema);
  makeTarget(
    "GatewayTargetCalendar",
    "calendar",
    toolCalendar.arn,
    "Read and create events on this agent's own connected Google Calendar (primary calendar).",
    calendarInputSchema,
  );
  makeTarget(
    "GatewayTargetBrowser",
    "browser",
    toolBrowser.arn,
    "Drive a real, JS-executing web browser — navigate to a page, click, type, take a screenshot, or extract " +
      "visible text. Slower and heavier than web_search or http_fetch; use it only when a page needs real " +
      "interaction or JS rendering that a plain fetch can't get you. The session is recorded for review.",
    browserInputSchema,
  );

  // The Web Search target can't use aws.bedrock.AgentcoreGatewayTarget (its TypeScript union type
  // has no `connector` variant — see file header comment), so it's created out-of-band via a raw
  // signed HTTP request, orchestrated here through a local.Command. `create`/`delete` both re-run
  // the same script with a different argv[0] action, both idempotent (see the script's own
  // comments) so a redeploy or a `pulumi up` with no changes doesn't error.
  const webSearchTarget = new command.local.Command(
    "WebSearchGatewayTarget",
    {
      create: `node ${JSON.stringify(CONNECTOR_TARGET_SCRIPT)} create`,
      delete: `node ${JSON.stringify(CONNECTOR_TARGET_SCRIPT)} delete`,
      environment: {
        GATEWAY_ID: gateway.gatewayId,
        TARGET_NAME: WEB_SEARCH_TARGET_NAME,
        CONNECTOR_ID: WEB_SEARCH_CONNECTOR_ID,
        CONNECTOR_VERSION: WEB_SEARCH_CONNECTOR_VERSION,
        AWS_REGION: GATEWAY_REGION,
      },
      triggers: [gateway.gatewayId],
    },
    { dependsOn: [gateway] },
  );

  return {
    gatewayUrl: gateway.gatewayUrl,
    gatewayArn: gateway.gatewayArn,
    webSearchToolArn: WEB_SEARCH_TOOL_ARN,
    // Exposed mainly for debugging/introspection — infra/api.ts doesn't need this.
    webSearchTargetId: webSearchTarget.stdout,
  };
}
