#!/usr/bin/env node
/**
 * Creates/deletes the `web-search` Gateway target using AWS's built-in Web Search connector
 * (`targetConfiguration.mcp.connector`), via a raw SigV4-signed HTTP request straight to the
 * `bedrock-agentcore-control` control-plane endpoint — NOT via the AWS CLI or Pulumi's native
 * `aws.bedrock.AgentcoreGatewayTarget` resource.
 *
 * Why: both the AWS CLI's bundled botocore service model and `@pulumi/aws`'s generated TypeScript
 * types for `AgentcoreGatewayTarget.targetConfiguration.mcp` are stale — neither one recognizes
 * `connector` as a valid variant, and reject it client-side before any network call is made
 * (`Unknown parameter in targetConfiguration.mcp: "connector", must be one of: openApiSchema,
 * smithyModel, lambda, mcpServer, apiGateway`). That looked at first like proof the connector
 * target type doesn't exist in the live API — it was a false conclusion. A raw SigV4-signed HTTP
 * POST straight to `https://bedrock-agentcore-control.<region>.amazonaws.com/gateways/{gatewayId}/
 * targets/`, bypassing all client-side parameter validation, was verified live to return
 * `HTTP 202` and produce a target that reaches `status: "READY"` within seconds. So the connector
 * genuinely works — the tooling was just behind the service. This script reproduces that exact
 * verified request.
 *
 * The Web Search connector is region-restricted to us-east-1 / eu-west-1 / ap-northeast-1 — the
 * same raw request against a Sydney (ap-southeast-2) Gateway got a clean, specific
 * `HTTP 400 {"message":"Connector integration web-search is not available for this account."}`,
 * a real business-logic rejection (not a parameter error), confirming the restriction is real and
 * current. The Gateway this targets must live in one of those three regions — see infra/web-search.ts.
 *
 * Invoked by infra/web-search.ts via a `command.local.Command` (`node
 * infra/scripts/agentcore-connector-target.mjs create|delete`), reading connection details from
 * env vars rather than argv so Pulumi's `environment` prop (which supports Output-typed values
 * resolved at apply time, e.g. the Gateway's not-yet-known id) can supply them.
 *
 * Usage: node agentcore-connector-target.mjs <create|delete>
 * Env vars: GATEWAY_ID, TARGET_NAME, CONNECTOR_ID, CONNECTOR_VERSION, AWS_REGION
 */
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

const action = process.argv[2];
if (action !== "create" && action !== "delete") {
  console.error(`agentcore-connector-target: expected "create" or "delete" as argv[2], got: ${action}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`agentcore-connector-target: missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const GATEWAY_ID = requireEnv("GATEWAY_ID");
const TARGET_NAME = requireEnv("TARGET_NAME");
const CONNECTOR_ID = requireEnv("CONNECTOR_ID");
const CONNECTOR_VERSION = requireEnv("CONNECTOR_VERSION");
const REGION = requireEnv("AWS_REGION");

const HOST = `bedrock-agentcore-control.${REGION}.amazonaws.com`;
const BASE_URL = `https://${HOST}`;

const signer = new SignatureV4({
  service: "bedrock-agentcore",
  region: REGION,
  credentials: defaultProvider(),
  sha256: Sha256,
});

/** Signs and sends one JSON request against the control-plane endpoint above. */
async function signedRequest(method, path, body) {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  const request = new HttpRequest({
    method,
    protocol: "https:",
    hostname: HOST,
    path,
    headers: {
      host: HOST,
      ...(bodyStr ? { "content-type": "application/json" } : {}),
    },
    body: bodyStr,
  });

  const signed = await signer.sign(request);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: signed.method,
    headers: signed.headers,
    body: signed.body,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return { status: res.status, json, text };
}

/** Lists this Gateway's targets and finds one by name, if any. */
async function findTargetByName() {
  const { status, json, text } = await signedRequest("GET", `/gateways/${GATEWAY_ID}/targets/`);
  if (status !== 200) {
    console.error(`agentcore-connector-target: unexpected status ${status} listing targets: ${text}`);
    process.exit(1);
  }
  const items = json?.items ?? [];
  return items.find((item) => item.name === TARGET_NAME);
}

async function create() {
  const existing = await findTargetByName();
  if (existing) {
    // Idempotent — a redeploy shouldn't error just because the target already exists.
    console.error(`agentcore-connector-target: target "${TARGET_NAME}" already exists (targetId=${existing.targetId}), skipping create`);
    console.log(existing.targetId);
    return;
  }

  const body = {
    name: TARGET_NAME,
    targetConfiguration: {
      mcp: {
        connector: {
          source: { connectorId: CONNECTOR_ID, version: CONNECTOR_VERSION },
          configurations: [{ name: "WebSearch", parameterValues: {} }],
        },
      },
    },
    credentialProviderConfigurations: [{ credentialProviderType: "GATEWAY_IAM_ROLE" }],
  };

  const { status, json, text } = await signedRequest("POST", `/gateways/${GATEWAY_ID}/targets/`, body);
  if (status !== 202 && status !== 200) {
    console.error(`agentcore-connector-target: unexpected status ${status} creating target: ${text}`);
    process.exit(1);
  }

  const targetId = json?.targetId;
  if (!targetId) {
    console.error(`agentcore-connector-target: create response had no targetId: ${text}`);
    process.exit(1);
  }

  console.error(`agentcore-connector-target: created target "${TARGET_NAME}" (targetId=${targetId}), status=${json?.status ?? "unknown"}`);
  // Last line of stdout, so Pulumi's command.local.Command `create` can capture it as this
  // resource's `stdout`.
  console.log(targetId);
}

async function del() {
  const existing = await findTargetByName();
  if (!existing) {
    console.error(`agentcore-connector-target: no target named "${TARGET_NAME}" found, nothing to delete`);
    return;
  }

  const { status, text } = await signedRequest("DELETE", `/gateways/${GATEWAY_ID}/targets/${existing.targetId}`);
  if (status !== 200 && status !== 202 && status !== 204) {
    console.error(`agentcore-connector-target: unexpected status ${status} deleting target ${existing.targetId}: ${text}`);
    process.exit(1);
  }

  console.error(`agentcore-connector-target: deleted target "${TARGET_NAME}" (targetId=${existing.targetId})`);
}

try {
  if (action === "create") await create();
  else await del();
} catch (err) {
  console.error(`agentcore-connector-target: unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
}
