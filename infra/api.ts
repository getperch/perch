/// <reference path="../.sst/platform/config.d.ts" />
import { makeGateway, toolsProvider } from "./gateway.js";

export function makeApi(args: {
  table: sst.aws.Dynamo;
  bus: sst.aws.Bus;
  auditBucket: sst.aws.Bucket;
  auditQueue: sst.aws.Queue;
  agentPluginsBucket: sst.aws.Bucket;
  agentRecordingsBucket: sst.aws.Bucket;
  agentMemoryBucket: sst.aws.Bucket;
}) {
  const { table, bus, auditBucket, auditQueue, agentPluginsBucket, agentRecordingsBucket, agentMemoryBucket } = args;

  // Connectors (Settings → Connectors) let a workspace admin wire Perch up to a third-party
  // product (Google Workspace today; more later). Each connector's credentials are entered at
  // runtime — deliberately NOT `sst.Secret`/deploy-time values, since most workspaces never wire
  // up a given connector — and stored as a per-workspace SSM SecureString at
  // `/perch/${stage}/${ws}/connectors/${connectorId}/client` (see
  // services/api/src/connector-config.ts). Connectors with a per-agent connect flow additionally
  // store one token per (agent, connector) at
  // `/perch/${stage}/${ws}/agents/${agent}/connectors/${connectorId}/token` (see
  // services/api/src/google-oauth.ts). Scoped by stage so dev/prod/PR stages never collide;
  // workspace/agent/connector segments are wildcarded since they're only known at request time.
  const accountId = aws.getCallerIdentityOutput({}).accountId;
  const region = aws.getRegionOutput({}).name;
  // Per-agent connector token: `/perch/${stage}/${ws}/agents/${agent}/connectors/${connectorId}/token`
  // (see services/api/src/google-oauth.ts's `googleAgentTokenSsmPath`). Per-workspace connector
  // client config: `/perch/${stage}/${ws}/connectors/${connectorId}/client` (see
  // services/api/src/connector-config.ts's `connectorClientSsmPath`). workspaceId/agentId/
  // connectorId are wildcarded — only known at request time.
  const connectorAgentTokenSsmArnPattern = $interpolate`arn:aws:ssm:${region}:${accountId}:parameter/perch/${$app.stage}/*/agents/*/connectors/*/token`;
  const connectorClientSsmArnPattern = $interpolate`arn:aws:ssm:${region}:${accountId}:parameter/perch/${$app.stage}/*/connectors/*/client`;

  // -- Per-agent isolation of the connector token read ------------------------------------------
  //
  // `ToolGmail`/`ToolCalendar` are shared singleton Lambdas — every agent's gmail/calendar call
  // runs the same function. A standing `ssm:GetParameter` grant on the wildcard
  // `.../agents/*/connectors/*/token` pattern would let any one tool call read any agent's token.
  // Static IAM on a shared role can't say "only for the agent this invocation is for", so instead
  // the tool Lambdas hold NO SSM permission directly: each invocation calls `sts:AssumeRole` on
  // this `ConnectorTokenReader` role, passing an inline session policy scoped to exactly the one
  // parameter ARN for the `__agentId` on the event (see services/tools/gmail/src/google-token.ts).
  // The base role below can read the whole family; the per-call session policy is what narrows each
  // actual read to a single agent.
  //
  // Trust is the account root, not the tool roles by ARN — referencing the SST-generated tool role
  // ARNs here would create a dependency cycle (role ⇄ function). The real gate is that ONLY the two
  // tool Lambdas are granted `sts:AssumeRole` on this role (their `permissions` blocks below);
  // nothing else in the account can assume it.
  const connectorTokenReaderRole = new aws.iam.Role("ConnectorTokenReader", {
    assumeRolePolicy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: $interpolate`arn:aws:iam::${accountId}:root` }, Action: "sts:AssumeRole" }],
    }),
  });
  new aws.iam.RolePolicy("ConnectorTokenReaderPolicy", {
    role: connectorTokenReaderRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["ssm:GetParameter"], Resource: [connectorAgentTokenSsmArnPattern, connectorClientSsmArnPattern] }],
    }),
  });

  // One Lambda per tool grant a workspace agent can hold — see services/tools/*. Each runs in its
  // own Firecracker microVM in isolation, reached only as a Gateway target (see infra/gateway.ts) —
  // none of these get their own env var/IAM grant on agentRuntime; agentRuntime talks MCP straight
  // to the Gateway that fronts them instead (see services/agent-runtime/src/mcp-gateways.ts).
  //
  // All 4 deploy via `toolsProvider` (us-east-1), not this app's home region — a Bedrock AgentCore
  // Gateway can only front Lambdas that live in its own region (confirmed live — see
  // infra/gateway.ts's file comment), and the Gateway has to be in us-east-1 for the Web Search
  // connector target. `gmail`/`calendar`/`browser` read/write real state (OAuth tokens, the
  // workspace table, the AgentCore Browser resource) that stays in the home region — they get an
  // explicit `HOME_REGION` env var so their own AWS SDK clients keep pointing at it regardless of
  // which region the Lambda itself now executes in (see each one's own source for the client that
  // reads it).
  const toolHttpFetch = new sst.aws.Function(
    "ToolHttpFetch",
    {
      handler: "services/tools/http-fetch/src/handler.handler",
    },
    { provider: toolsProvider },
  );

  // Each of these calls out to Google's own APIs using the calling agent's own connected Google
  // account (see services/tools/gmail and services/tools/calendar's file comments) — no session
  // state between calls, so no `link: [table]` needed the way ToolBrowser has for its session
  // cache. `STAGE` + the session-policy ARN the handler builds from `ACCOUNT_ID`/`HOME_REGION`
  // must match services/api/src/google-oauth.ts + connector-config.ts's path conventions exactly.
  // No direct SSM grant — the token read goes through `ConnectorTokenReader` with a per-invocation
  // session policy scoped to the calling agent's own parameter (see that role's comment above and
  // services/tools/gmail/src/google-token.ts). `ACCOUNT_ID`/`HOME_REGION` let the handler build the
  // exact parameter ARN for that session policy; `CONNECTOR_TOKEN_READER_ROLE_ARN` is the role to
  // assume.
  const toolConnectorEnv = {
    STAGE: $app.stage,
    HOME_REGION: region,
    ACCOUNT_ID: accountId,
    CONNECTOR_TOKEN_READER_ROLE_ARN: connectorTokenReaderRole.arn,
  };
  const toolGmail = new sst.aws.Function(
    "ToolGmail",
    {
      handler: "services/tools/gmail/src/handler.handler",
      environment: toolConnectorEnv,
      permissions: [{ actions: ["sts:AssumeRole"], resources: [connectorTokenReaderRole.arn] }],
    },
    { provider: toolsProvider },
  );
  const toolCalendar = new sst.aws.Function(
    "ToolCalendar",
    {
      handler: "services/tools/calendar/src/handler.handler",
      environment: toolConnectorEnv,
      permissions: [{ actions: ["sts:AssumeRole"], resources: [connectorTokenReaderRole.arn] }],
    },
    { provider: toolsProvider },
  );

  // The AgentCore Browser control-plane resource `toolBrowser` (below) drives over CDP — session
  // infrastructure only, not an automation API of its own. Confirmed live this session: Gateway
  // has no managed connector for browser actions the way it does for Web Search (every plausible
  // connectorId — "browser", "browsing", "web-browser", "browser-automation", "playwright" — got
  // the same generic `400 "Connector integration X is not available for this account."` a
  // genuinely-missing connector gets, not the distinct region-restriction error Web Search's real
  // connector returns when hit from the wrong region); `aws.bedrock.AgentcoreBrowser`'s own docs
  // confirm it too — no automation methods, just network/execution-role/recording config. So this
  // stays a real Lambda driving a real session, same as before — what changes here is only that
  // the session-hosting resource itself is now provisioned by Pulumi instead of a manual
  // `CreateBrowserCommand`/console step (infra/README.md's prior "No control-plane provisioning"
  // note). Lives in the home region, not `toolsProvider` (us-east-1) — nothing about it is
  // Gateway-region-restricted, and `toolBrowser`'s `BedrockAgentCoreClient` is already pinned to
  // `HOME_REGION` to reach it.
  const browserRole = new aws.iam.Role("ToolBrowserExecutionRole", {
    assumeRolePolicy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "bedrock-agentcore.amazonaws.com" }, Action: "sts:AssumeRole" }],
    }),
  });
  new aws.iam.RolePolicy("ToolBrowserExecutionRolePolicy", {
    role: browserRole.id,
    policy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [{ Sid: "WriteRecordings", Effect: "Allow", Action: "s3:PutObject", Resource: $interpolate`${agentRecordingsBucket.arn}/browser-sessions/*` }],
    }),
  });
  // Recording destination wired here closes the other gap infra/README.md flagged — the bucket
  // existed and was linked to `toolBrowser` already, but nothing had ever told AgentCore to
  // actually write sessions there.
  const browser = new aws.bedrock.AgentcoreBrowser("ToolBrowserResource", {
    // Unlike every other resource `name` in this repo, AgentcoreBrowser's `name` rejects hyphens
    // — confirmed live: `ValidationException: Value 'perch-robss-browser' at 'name' failed to
    // satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z][a-zA-Z0-9_]{0,47}`.
    name: `perch_${$app.stage}_browser`,
    description: "Browser sessions driven by ToolBrowser (services/tools/browser-agentcore)",
    executionRoleArn: browserRole.arn,
    networkConfiguration: { networkMode: "PUBLIC" },
    recording: { enabled: true, s3Location: { bucket: agentRecordingsBucket.name, prefix: "browser-sessions/" } },
  });

  const toolBrowser = new sst.aws.Function(
    "ToolBrowser",
    {
      handler: "services/tools/browser-agentcore/src/handler.handler",
      timeout: "2 minutes",
      link: [table, agentRecordingsBucket],
      environment: {
        WORKSPACE_TABLE_NAME: table.name,
        AGENT_RECORDINGS_BUCKET_NAME: agentRecordingsBucket.name,
        AGENTCORE_BROWSER_ID: browser.browserId,
        HOME_REGION: region,
      },
      permissions: [
        {
          actions: ["bedrock-agentcore:StartBrowserSession", "bedrock-agentcore:StopBrowserSession", "bedrock-agentcore:ConnectBrowserAutomationStream"],
          resources: ["*"],
        },
      ],
      // playwright-core's bundle has a `require("chromium-bidi/...")` for its BiDi protocol
      // support — a real code path in the package, but not one this handler ever exercises (it
      // only uses `chromium.connectOverCDP`, never BiDi). `chromium-bidi` isn't installed
      // anywhere in this repo (confirmed — no @chromium-bidi entry in the pnpm store) since
      // nothing here needs it; esbuild still tries to statically resolve it while bundling and
      // fails outright. Marking it external (not `nodejs.install`, which would require it to
      // actually be installed) leaves it as a plain runtime `require` that's simply never called.
      nodejs: { esbuild: { external: ["chromium-bidi"] } },
    },
    { provider: toolsProvider },
  );

  // The Bedrock AgentCore Gateway that fronts every tool this app has — http_fetch/gmail/calendar/
  // browser as `lambda`-type MCP targets, plus AWS's managed Web Search connector — see
  // infra/gateway.ts's file comment. agentRuntime (below) talks native MCP straight to this
  // Gateway via services/agent-runtime/src/mcp-gateways.ts — no shim Lambda in between any more
  // (there used to be one, services/tools/gateway-caller, removed once agent-runtime started
  // connecting directly; there used to be two Gateways too, merged into this one — see
  // infra/gateway.ts's file comment for why that required moving these 4 Lambdas to us-east-1).
  const gateway = makeGateway({ toolHttpFetch, toolGmail, toolCalendar, toolBrowser });

  // sst.aws.Workflow (not a plain Function) is required for AWS Lambda durable execution: the
  // DurableConfig it sets is baked in at function *creation* and AWS has no API to add it after
  // the fact (confirmed via a failed `update-function-configuration --durable-config` call against
  // the old plain-Function version of this resource — see infra/README.md's now-resolved note).
  const agentRuntime = new sst.aws.Workflow("AgentRuntime", {
    handler: "services/agent-runtime/src/handler.handler",
    // Per-invocation cap, not a per-step or total-execution cap — a single reasoning turn with
    // tool calls can run long, but the workflow itself yields/replays across invocations so the
    // `execution` ceiling (14-day default) is irrelevant here.
    timeout: { invocation: "15 minutes" },
    // Linking the bucket is what grants this function read/write on it — the agent loop persists
    // Strands session snapshots and reads/writes the workspace's OKF knowledge bundle here (see
    // services/agent-runtime/src/memory.ts).
    link: [table, bus, agentMemoryBucket],
    environment: {
      WORKSPACE_TABLE_NAME: table.name,
      EVENT_BUS_NAME: bus.name,
      // agentRuntime talks native MCP straight to the one Gateway now (see
      // services/agent-runtime/src/mcp-gateways.ts) — no shim Lambda ARN to look up any more, just
      // the Gateway URL itself.
      TOOL_GATEWAY_URL: gateway.gatewayUrl,
      AGENT_MEMORY_BUCKET_NAME: agentMemoryBucket.name,
    },
    permissions: [
      // These two grants used to sit on the now-deleted services/tools/gateway-caller and
      // services/tools/web-search shim Lambdas — moved onto agentRuntime directly since it's now
      // the one making the MCP calls (see services/agent-runtime/src/mcp-gateways.ts).
      { actions: ["bedrock-agentcore:InvokeGateway"], resources: [gateway.gatewayArn] },
      { actions: ["bedrock-agentcore:InvokeWebSearch"], resources: [gateway.webSearchToolArn] },
      // Bedrock's OpenAI-compatible "Mantle" endpoint (used for model lines Bedrock only
      // serves that way, e.g. google.gemma-* — see services/agent-runtime/src/model.ts) sits
      // behind its own IAM action namespace, separate from bedrock:InvokeModel/Converse.
      { actions: ["bedrock-mantle:CreateInference", "bedrock-mantle:CallWithBearerToken"], resources: ["*"] },
      // Every other model — the standard bedrock-runtime path, which this repo had genuinely
      // never granted at all until now (confirmed live: an agent switched to a bedrock-runtime
      // model hit "not authorized to perform: bedrock:InvokeModelWithResponseStream... because no
      // identity-based policy allows" — this wasn't a regression, there was just never a grant
      // here). Strands' `BedrockModel` (the default path `resolveModel` returns for any model id
      // not routed through Mantle — see model.ts) can use either the older Invoke/
      // InvokeModelWithResponseStream operations or the newer Converse/ConverseStream ones
      // depending on SDK internals, so both pairs are granted rather than guessing which.
      // Model id wildcarded deliberately, on request — the alternative (an explicit allow-list of
      // model ARNs, one per model an agent might be configured with) means every time someone
      // picks a new model in the UI, a deploy is needed first to grant it or every run for that
      // agent fails the same way this one did. `foundation-model` ARNs are AWS-owned (no account
      // segment — note the double colon before the empty segment, matching the exact ARN shape
      // from the live AccessDenied error above), so this can't be scoped down to "this account's
      // own models" the way most other wildcards in this file are — the model id is genuinely the
      // only thing left to constrain, and wildcarding it is what "pick any model without a
      // redeploy" requires. `inference-profile` resources (used for cross-region model routing on
      // some model/region combinations) ARE account-owned, wildcarded the same way for the same
      // reason.
      {
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"],
        resources: [$interpolate`arn:aws:bedrock:${region}::foundation-model/*`, $interpolate`arn:aws:bedrock:${region}:${accountId}:inference-profile/*`],
      },
    ],
  });

  const api = new sst.aws.Function("ApiFunction", {
    handler: "services/api/src/handler.handler",
    // Linking a Workflow grants the invoke + durable-callback permissions services/api needs to
    // start executions (messages.ts) and resolve approval callbacks (durable-callback.ts) —
    // see Function.getSSTLink()'s `durable` branch — so no manual `permissions` block for it.
    link: [table, bus, agentPluginsBucket, agentMemoryBucket, agentRuntime],
    environment: {
      WORKSPACE_TABLE_NAME: table.name,
      EVENT_BUS_NAME: bus.name,
      AGENT_PLUGINS_BUCKET_NAME: agentPluginsBucket.name,
      // Human-side CRUD + verification over the same OKF bundle the agents read/write (see
      // services/api/src/okf-store.ts and services/api/src/routers/knowledge.ts).
      AGENT_MEMORY_BUCKET_NAME: agentMemoryBucket.name,
      STAGE: $app.stage,
    },
    // Scoped to exactly the per-workspace connector client config path and the per-agent connector
    // token path (see services/api/src/connector-config.ts + google-oauth.ts) — this function can
    // create/read/delete only those two parameter families, not arbitrary SSM parameters.
    permissions: [
      { actions: ["ssm:PutParameter", "ssm:GetParameter", "ssm:DeleteParameter"], resources: [connectorAgentTokenSsmArnPattern, connectorClientSsmArnPattern] },
      // `GET /models` lists the account's on-demand Bedrock models (services/api/src/routers/models.ts).
      // ListFoundationModels has no resource-level scoping, so it's `*`.
      { actions: ["bedrock:ListFoundationModels"], resources: ["*"] },
    ],
  });

  // The OpenAuth server, mounted as ordinary routes on this same REST API (see auth-issuer.ts)
  // rather than as a separate component/domain — one URL for everything, no CloudFront needed.
  // Deliberately unauthenticated — a client can't have a token yet.
  const authIssuer = new sst.aws.Function("AuthIssuer", {
    handler: "services/api/src/auth-issuer.handler",
    link: [table],
    environment: { WORKSPACE_TABLE_NAME: table.name },
  });

  const restApi = new sst.aws.ApiGatewayV1("Api", {
    accessLog: { retention: "3 months" },
  });
  const authorizer = restApi.addAuthorizer({
    name: "openauth",
    requestFunction: {
      handler: "services/api/src/authorizer.handler",
      // restApi.url has a trailing slash — interpolating it straight in produces a double
      // slash ("/robss//auth"), which breaks path-prefix comparisons downstream in
      // authorizer.ts. Strip it first.
      environment: { OPENAUTH_ISSUER_URL: restApi.url.apply((url) => `${url.replace(/\/+$/, "")}/auth`) },
    },
    identitySource: "method.request.header.Authorization",
  });

  restApi.route("ANY /api/{proxy+}", api.arn, { auth: { custom: authorizer.id } });
  restApi.route("ANY /auth/{proxy+}", authIssuer.arn);
  restApi.deploy();

  const auditWriter = new sst.aws.Function("AuditWriter", {
    handler: "services/audit-writer/src/handler.handler",
    // `link: [auditQueue]` is what grants this function's role permission to consume the queue —
    // without it, the event source mapping below has nothing to authorize it against.
    link: [table, auditBucket, auditQueue],
    environment: { WORKSPACE_TABLE_NAME: table.name, AUDIT_BUCKET_NAME: auditBucket.name },
  });
  auditQueue.subscribe(auditWriter.arn, { batch: { size: 1 } });

  return { restApi, api, authIssuer, agentRuntime, auditWriter, toolHttpFetch, toolBrowser, toolGmail, toolCalendar };
}
