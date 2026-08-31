# infra

SST v3 (`ion`) stack definitions, imported by `../sst.config.ts` at the repo root (SST's CLI
requires `sst.config.ts` to live at the project root it's run from — see that file).

## DynamoDB key schema (single table, `Table`)

| Entity | PK | SK |
|---|---|---|
| Workspace | `WORKSPACE#<id>` | `META` |
| Channel | `WORKSPACE#<id>` | `CHANNEL#<id>` |
| Member | `WORKSPACE#<id>` | `MEMBER#<id>` |
| Google Workspace connection (per-agent, non-secret metadata — the refresh token itself is an SSM `SecureString` at `/perch/<stage>/<workspaceId>/agents/<memberId>/google-workspace-refresh-token`, not in this table) | `WORKSPACE#<id>` | `MEMBER#<id>#GOOGLE_WORKSPACE` |
| Task | `WORKSPACE#<id>` | `TASK#<id>` |
| Approval | `WORKSPACE#<id>` | `APPROVAL#<id>` |
| Run | `WORKSPACE#<id>` | `RUN#<id>` |
| Audit chain state | `WORKSPACE#<id>` | `AUDITCHAIN` |
| RunStep | `RUN#<id>` | `STEP#<ulid>` |
| Message | `CHANNEL#<id>` | `MSG#<ulid>` |
| ChannelEvent (SSE tail source) | `CHANNEL#<id>` | `EVENT#<ulid>` |

## Deploy

```sh
pnpm install
pnpm sst:dev     # sst dev, from the repo root
pnpm sst:deploy
```

Paste the printed `apiUrl` into the desktop/mobile app's "Connect to your backend" screen on
first launch and it remembers the connection on disk — there's only one URL, ever, and no
CloudFront/custom domain involved. `/auth/*` on the same REST API is `services/api/src/
auth-issuer.ts`, an OpenAuth server (`@openauthjs/openauth`) mounted directly as a route via
Hono's `.route("/auth", ...)` composition, reusing the main DynamoDB table for its own storage
(codes, sessions, password hashes — namespaced separately from the WORKSPACE#/CHANNEL# keys the
rest of the app uses). It renders its own minimal login/register/reset HTML (`auth-pages.ts`)
instead of OpenAuth's bundled PasswordUI — every link and form action in those pages is a
relative path, which is specifically what makes the `/auth` mount work correctly, since
OpenAuth's own subpath/basePath support is still immature. Sign-in/registration hands off to the
system browser against that `/auth` path. `services/api/src/authorizer.ts` is the Lambda REQUEST
authorizer that verifies the resulting tokens on every other API Gateway route.

The first account to sign up bootstraps the workspace and becomes its owner; every account after
that must already exist as a `Person` member (added via the People screen) before they can sign
in — see `workspace-bootstrap.ts`. No email provider is wired up yet, so the password provider's
verification codes are only logged to the `AuthIssuer` Lambda's CloudWatch logs — swap
`sendCode` in `auth-issuer.ts` for SES (or similar) before relying on this for real users.

## Things flagged for verification before relying on this in production

A few pieces of this stack lean on AWS/SST surfaces that shipped very recently (2025–2026) —
double-check these against current docs before trusting them at scale:

- **S3 Object Lock on `sst.aws.Bucket`** (`infra/storage.ts`) — enabled via the `transform` escape
  hatch since it isn't a first-class prop on the component. AWS requires Object Lock to be set at
  bucket *creation*; it can't be turned on later.
- **API Gateway REST API response streaming** — real incremental flushing (GA'd across all
  commercial regions in April 2026) needs a Lambda proxy integration built against the
  `.../response-streaming-invocations` action (not `.../invocations`) with `responseTransferMode:
  "STREAM"` on the `Integration` resource (see AWS's
  [response-transfer-mode-lambda](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html)
  docs). As of the SST v3→v4 / `@pulumi/aws` v6→v7 upgrade (see the `DurableConfig` note below),
  `responseTransferMode` now shows up on `aws.apigateway.Integration` in `sst diff`'s output for
  the first time — the provider gap that previously blocked this may be closed. Not yet verified
  or turned on; the SSE route (`GET /channels/{channelId}/events`,
  `services/api/src/routers/channel-events.ts`) still uses `hono/streaming`'s `streamSSE` with a
  bounded ~25s window per request rather than true indefinite streaming. Worth re-checking whether
  a `transform` on `ApiGatewayV1LambdaRoute`'s `Integration` can now set `STREAM` before deciding
  it's still blocked.
- **`@aws/durable-execution-sdk-js` and `@strands-agents/sdk` API surface** (`services/agent-runtime`)
  — both packages are new (Strands TypeScript support and Lambda durable functions both shipped
  in the few months before this was written). The `DurableContext.step/invoke/createCallback`
  calls and the `Agent`/`tool()` shapes here match their published docs at the time of writing,
  but pin versions and check changelogs before deploying.
- **`DurableConfig` on the `AgentRuntime` function — RESOLVED.** Originally `infra/api.ts` declared
  `AgentRuntime` as a plain `sst.aws.Function` wrapped in `withDurableExecution()`, which doesn't
  work: AWS bakes `DurableConfig` in at function *creation* with no update-after-the-fact path
  (confirmed via a real, failed `aws lambda update-function-configuration --durable-config '{}'`
  call: *"You cannot add a durable configuration to a function that was originally created with no
  durable configuration"*), and the `@pulumi/aws` v6 provider this stack originally vendored had no
  `transform` escape hatch for `durableConfig` on `aws.lambda.Function` either. Fixed by switching
  to SST's dedicated `sst.aws.Workflow` component (added in `sst@4.7.0`, shipped after this was
  first written), which sets `DurableConfig` correctly at creation and wraps
  `@aws/durable-execution-sdk-js` with its own `workflow.handler()`/`workflow.start()` SDK — see
  `infra/api.ts`, `services/agent-runtime/src/handler.ts`, and
  `services/api/src/routers/messages.ts`/`durable-callback.ts`. This required bumping `sst` from
  `^3.9.0` to `^4.17.1`, which pulls in `@pulumi/aws` v7 (up from v6) — a one-way state migration
  (`sst refresh` then `sst deploy`) confirmed via `sst diff` to touch only compute/glue resources
  (Lambda functions, IAM roles, code bundles, API Gateway wiring); no DynamoDB table, S3 bucket,
  queue, or event bus is deleted or replaced.

- **Bedrock AgentCore Browser tool** (`services/tools/browser-agentcore`) — the command/field
  names (`StartBrowserSessionCommand`, `GetBrowserSessionCommand`, `StopBrowserSessionCommand`,
  `streams.automationStream.streamEndpoint`, `sessionReplayArtifact`) are confirmed against the
  actual installed `@aws-sdk/client-bedrock-agentcore@3.1117.0` source, not guessed — but one
  thing still needs real verification before this is trustworthy in production:
  - **Control-plane provisioning is now automated** (`infra/api.ts`'s `browser`, an
    `aws.bedrock.AgentcoreBrowser`) — this used to be a manual `CreateBrowserCommand`/console step
    with the resulting id hand-set via `process.env.AGENTCORE_BROWSER_ID`. Lives in the app's home
    region (ap-southeast-2, not us-east-1 — see the Gateway note below for why `ToolBrowser` itself
    deploys to us-east-1 while everything it talks to, including this resource, stays put), with
    recording enabled straight to `AgentRecordingsBucket` (`infra/storage.ts`) at a
    `browser-sessions/` prefix — closing the "nothing has told AgentCore to write there" gap this
    note used to flag. Confirmed live this session, while investigating whether `ToolBrowser`
    itself could be replaced by a managed Gateway connector (it can't — see the Gateway note below):
    Bedrock AgentCore Gateway has no managed *browser-driving* connector the way it does for Web
    Search, and `aws.bedrock.AgentcoreBrowser` itself is control-plane-only (network config,
    execution role, recording — no automation methods), so `ToolBrowser`'s own CDP-driving code
    stays necessary; only the resource it drives is now IaC-managed.
  - **`sessionReplayArtifact` isn't presigned or otherwise made fetchable for the UI.** It's
    whatever AgentCore returns (shape/location TBD until a real Browser resource exists to test
    against) and may only populate once the session ends — this tool's idle-TTL-only lifecycle
    (see `session.ts`) means `RunDetailScreen`'s "Watch recording" link can be absent or briefly
    stale right after a run finishes, and depending on what `sessionReplayArtifact` actually
    contains (an S3 URI vs. an already-signed URL), the link may need presigning before it's
    usable from the browser.

- **Bedrock AgentCore Gateway — one Gateway, in us-east-1, fronting every tool.** `infra/gateway.ts`
  is the single source of truth (both the 4 `lambda`-type targets — http_fetch/gmail/calendar/
  browser — and AWS's managed Web Search connector). It's in us-east-1, not this app's home region,
  because of two independent, both-verified-live region constraints that only overlap in one
  region family:
  - **Web Search connector is region-restricted** to `us-east-1`/`eu-west-1`/`ap-northeast-1`.
    Verified live: a raw SigV4-signed POST to `/gateways/{gatewayId}/targets/` with
    `targetConfiguration.mcp.connector.source.{connectorId: "web-search", version: "1.2.0"}` in
    us-east-1 returns `HTTP 202` and reaches `status: "READY"` within seconds; the identical
    request against an ap-southeast-2 Gateway gets a clean `HTTP 400 {"message":"Connector
    integration web-search is not available for this account."}` — a real business-logic
    rejection, not a parameter error. (The AWS CLI and Pulumi's native
    `aws.bedrock.AgentcoreGatewayTarget` both reject the `connector` field client-side —
    `Unknown parameter in targetConfiguration.mcp: "connector"` — because the CLI's bundled
    botocore service model and `@pulumi/aws`'s generated types are stale, not because the live API
    doesn't support it. Don't trust `aws bedrock-agentcore-control create-gateway-target help`'s
    parameter list as evidence a field isn't supported — verify with a raw signed HTTP request.
    Because of this staleness, the Web Search target is created out-of-band via a
    `command.local.Command` shelling out to `infra/scripts/agentcore-connector-target.mjs`, a
    standalone Node script that does its own SigV4 signing and POSTs directly to the control-plane
    endpoint.)
  - **`lambda`-type targets are region-locked to the Gateway's own region, not the Lambda's.**
    Confirmed live: creating a target on a us-east-1 Gateway pointing at a real, deployed
    ap-southeast-2 Lambda's ARN gets `ValidationException: Lambda function not found` — the
    control plane looks the Lambda up in the Gateway's own region and doesn't find it there, even
    though the ARN is valid.

  Combined, getting one Gateway means the 4 tool Lambdas had to move to us-east-1 (via
  `infra/gateway.ts`'s exported `toolsProvider`), not the Gateway moving to match them. This app's
  home region (auth, DB, `services/api`, `AgentRuntime`) is unaffected — only
  http_fetch/gmail/calendar/browser deploy to us-east-1, and `gmail`/`calendar`/`browser` pin their
  own AWS SDK clients (SSM, DynamoDB, `BedrockAgentCoreClient`) back to the home region via a
  `HOME_REGION` env var, since none of the actual state those calls touch is moving.

## Google Workspace (Gmail + Calendar) connect flow

Lets any workspace member grant an agent a `gmail`/`calendar` tool and then connect *their own*
Google account to that specific agent — a real per-agent OAuth flow, not a shared/global
credential. See `apps/desktop/src-tauri/src/google_workspace.rs` (the desktop-side PKCE flow,
sibling of `auth.rs`'s own-app sign-in), `services/api/src/routers/google-workspace.ts` +
`services/api/src/google-oauth.ts` (the backend token exchange/storage), and
`services/tools/gmail` / `services/tools/calendar` (the tool Lambdas that use the stored
connection). Everything here degrades to a clear, visible error — never a silent failure or a
fabricated connection — until the manual setup below is done.

**One-time manual setup (only a human can do this part):**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an
   existing one) and enable the **Gmail API** and **Google Calendar API** under "APIs & Services".
2. Under "APIs & Services" → "OAuth consent screen", configure the consent screen (External or
   Internal, depending on your Google Workspace setup) and add the scopes this app requests:
   `gmail.readonly`, `gmail.send`, `calendar.events` (see `google_workspace.rs`'s `SCOPES`
   constant — the exact list actually requested).
3. Under "APIs & Services" → "Credentials", create an OAuth client ID of type **Desktop app**.
   Google issues both a client ID and a client secret for this type — this app needs both (the
   token exchange happens server-side in `services/api`, not in the Rust binary, so the secret is
   never embedded in anything shipped to a user's machine).
4. In the Perch desktop app, open **Settings → Integrations → Google Workspace** and paste in the
   client ID and client secret, then Save. This is a runtime, per-workspace configuration step —
   not a deploy-time one: it's stored as an SSM `SecureString` (`PUT /google-workspace/client`,
   see `services/api/src/google-oauth.ts`'s `storeGoogleOAuthClient`/`googleOAuthClientSsmPath`),
   not an `sst.Secret`, precisely because most workspaces may never use Gmail/Calendar and
   shouldn't need anything set at deploy time for the base app to work. Until this is done,
   `GET /google-workspace/client-id`, the connect endpoint, and both tool Lambdas' token refresh
   all fail with a clear "Google Workspace isn't configured for this workspace yet — a workspace
   admin needs to add the Google OAuth client in Settings → Integrations" error rather than
   crashing or pretending to work — see `services/api/src/google-oauth.ts`'s
   `requireGoogleOAuthClient`.
5. No redirect URI needs registering for a Desktop app OAuth client — Google allows
   `http://127.0.0.1:<port>` / `http://localhost:<port>` **loopback** redirects for that client
   type without an allowlist. The desktop connect flow (`apps/desktop/src-tauri/src/google_workspace.rs`)
   binds a throwaway `127.0.0.1` listener per attempt and uses that as the `redirect_uri`.
   (Custom URI schemes like `perch://…` are **not** accepted for Desktop clients — Google returns
   `Error 400: invalid_request`; they're only for iOS/Android client types.)

**Not yet verified** (flagged the same way as the other integrations below): the real Google
token/userinfo endpoints haven't been exercised against a live OAuth client — the request/response
shapes in `services/api/src/google-oauth.ts` and the two tool handlers are built from Google's
documented API, not a live call. Verify the full connect → tool-call round trip once a real client
id/secret pair is set.

## Regenerating the OpenAPI spec for the desktop app's Rust client

`services/api/openapi.json` is committed, not generated at build time — `apps/desktop/src-tauri`'s
`build.rs` reads it directly and generates Rust request/response structs from it via `typify` on
every `cargo build`. Whenever a route's Zod input/output schema changes in `services/api/src/
routers/*.ts`, re-run `pnpm --filter @perch/api generate-openapi` and commit the updated
`openapi.json` so the Rust side picks up the change on its next build. `@hono/zod-openapi` inlines
every schema at its usage site here (no route calls `.openapi("Name")`, so `components.schemas` is
always empty) — `build.rs` walks `paths` directly and generates one named type per request/response
body instead of the more typical "extract shared named components" approach, which means the same
underlying shape (e.g. a channel) gets a separately-named Rust struct per endpoint that returns it,
rather than one shared type. Works, but if the duplication becomes annoying, the fix is on the
`services/api` side: give the reused schemas in `packages/api-contract` (or at their point of use in
each router) an `.openapi("Name")` call so they're emitted as real shared `components.schemas`
entries, then simplify `build.rs` back to the more standard `add_ref_types` extraction.
