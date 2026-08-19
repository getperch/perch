import { z } from "zod";

/**
 * One Lambda per tool, registered as a Bedrock AgentCore Gateway target (see infra/gateway.ts) and
 * invoked directly by Gateway — each call still gets its own Firecracker microVM, which is the
 * isolation boundary this architecture uses instead of a custom sandbox; Gateway only mediates
 * discovery/routing, it doesn't run the tool's code itself. This is the reference implementation
 * new tools should copy.
 *
 * Gateway's own Lambda-target invocation contract hands this Lambda's `event` as *only* the
 * tool's declared inputSchema properties, flat — no envelope. services/agent-runtime/src/tools.ts's
 * `ApprovalInterventionHandler` injects three reserved double-underscore-prefixed keys onto that
 * flat object, before the call ever reaches Gateway, for tools that need per-call context Gateway
 * itself has no channel for: `__workspaceId`/`__agentId`/`__runId` (see its file comment). This
 * tool doesn't need any of them — it just strips them before validating the real arguments against
 * `inputSchema`. See services/tools/gmail or services/tools/browser-agentcore's handlers for a
 * tool that actually reads one.
 *
 * The Lambda's second (AWS Lambda `Context`) parameter carries `bedrockAgentCoreToolName` (which
 * tool Gateway thinks it called) at `context.clientContext?.custom?.bedrockAgentCoreToolName` —
 * this repo has no tool that currently needs it (each Lambda already knows its own identity from
 * its own code), so it's not read here; pull it from that path if a future tool genuinely needs
 * to know the Gateway-qualified name it was invoked as.
 */
const inputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "HEAD"]).default("GET"),
});

function stripReservedKeys(event: unknown): Record<string, unknown> {
  if (typeof event !== "object" || event === null) return {};
  const { __workspaceId, __agentId, __runId, ...rest } = event as Record<string, unknown>;
  return rest;
}

export const handler = async (rawEvent: unknown) => {
  const input = inputSchema.parse(stripReservedKeys(rawEvent));
  console.log(`http_fetch: ${input.method} ${input.url}`);

  const res = await fetch(input.url, { method: input.method });
  const body = await res.text();

  console.log(`http_fetch: ${input.method} ${input.url} -> ${res.status}, ${body.length} bytes`);

  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? undefined,
    body: body.slice(0, 20_000),
  };
};
