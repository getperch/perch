import { BedrockAgentCoreClient, GetBrowserSessionCommand, StartBrowserSessionCommand, StopBrowserSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { chromium } from "playwright-core";
import { z } from "zod";
import { getOrCreateSession } from "./session.js";

/**
 * The one deliberate exception to this codebase's "every tool is a bare Lambda calling out
 * directly" pattern (see agent-runtime/src/tools.ts's comment) — driving a real, JS-executing
 * browser well enough to get useful extraction and a recording isn't worth building from scratch
 * in a Firecracker microVM, so this tool is a thin driver on top of Bedrock AgentCore's managed
 * Browser tool instead.
 *
 * Verified against the installed `@aws-sdk/client-bedrock-agentcore` (3.1117.0) source directly —
 * `StartBrowserSessionCommand` only creates a *new* session (no way to resume an existing one by
 * id), so a run's 2nd+ browser call instead uses `GetBrowserSessionCommand` to re-fetch that
 * session's CDP endpoint. AgentCore returns two stream endpoints on both calls:
 * `streams.automationStream.streamEndpoint` (CDP, what `playwright-core` connects to for actual
 * navigate/click/type calls — AgentCore's own API has no per-action "click"/"type" operation) and
 * `streams.liveViewStream.streamEndpoint` (for a human to watch live, unused here).
 *
 * Session replay/recording is exposed as `sessionReplayArtifact` on `GetBrowserSessionResponse` —
 * there's no explicit "recording config" on `StartBrowserSessionCommand` itself, so where that
 * artifact lands is presumably controlled by the Browser *resource's* own configuration (the
 * control-plane object sessions run against, created once via
 * `@aws-sdk/client-bedrock-agentcore-control`'s `CreateBrowserCommand` — see infra/README.md's
 * browser-tool setup note, which this repo doesn't automate). `sessionReplayArtifact` may not be
 * populated until the session ends, matching this tool's idle-TTL-only session lifecycle (see
 * session.ts) — so a recording link may 404/be absent until then.
 */

const inputSchema = z.object({
  action: z.enum(["navigate", "click", "type", "screenshot", "extract_text"]),
  url: z.string().url().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
});

// Invoked directly by Bedrock AgentCore Gateway as a lambda-type target (see infra/gateway.ts) —
// this Lambda's `event` is the flat tool-arguments object, plus a reserved `__runId` key that
// services/agent-runtime/src/tools.ts's `ApprovalInterventionHandler` injects into every granted
// tool call before it's dispatched. This is the one tool that DOES need it, to key the AgentCore
// browser session reused across a run's calls (see session.ts below) — see services/tools/http-fetch's
// handler for the full explanation of why this rides along outside the model-facing schema.
const reservedContextSchema = z.object({ runId: z.string() });

function extractContext(event: Record<string, unknown>) {
  return reservedContextSchema.parse({ runId: event.__runId });
}

function stripReservedKeys(event: Record<string, unknown>): Record<string, unknown> {
  const { __workspaceId, __agentId, __runId, ...rest } = event;
  return rest;
}

// This Lambda deploys to us-east-1 (see infra/gateway.ts's file comment — Gateway can only front
// Lambdas in its own region), but the AgentCore Browser control-plane resource this talks to is
// provisioned in the app's home region (infra/README.md's manual CreateBrowserCommand step never
// moved) — pin explicitly. Unlike the Gateway-to-Lambda invocation this tool is itself reached
// through, this is a plain regional AWS SDK call, so pointing it cross-region works fine.
const client = new BedrockAgentCoreClient({ region: process.env.HOME_REGION });
const BROWSER_IDENTIFIER = process.env.AGENTCORE_BROWSER_ID ?? "";

async function startSession(): Promise<{ sessionId: string; wsEndpoint: string }> {
  const res = await client.send(new StartBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, name: "perch-agent-run" }));
  const wsEndpoint = res.streams?.automationStream?.streamEndpoint;
  if (!res.sessionId || !wsEndpoint) throw new Error("AgentCore did not return a session id / automation stream endpoint");
  return { sessionId: res.sessionId, wsEndpoint };
}

async function reconnect(sessionId: string): Promise<string> {
  const res = await client.send(new GetBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, sessionId }));
  const wsEndpoint = res.streams?.automationStream?.streamEndpoint;
  if (!wsEndpoint) throw new Error(`could not resolve automation stream endpoint for session ${sessionId}`);
  return wsEndpoint;
}

async function recordingUrlFor(sessionId: string): Promise<string | undefined> {
  const res = await client.send(new GetBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, sessionId }));
  return res.sessionReplayArtifact;
}

export const handler = async (rawEvent: unknown) => {
  const event = typeof rawEvent === "object" && rawEvent !== null ? (rawEvent as Record<string, unknown>) : {};
  const { runId } = extractContext(event);
  const input = inputSchema.parse(stripReservedKeys(event));
  const { sessionId, wsEndpoint } = await getOrCreateSession(runId, startSession, reconnect);
  const browser = await chromium.connectOverCDP(wsEndpoint);

  try {
    const browserContext = browser.contexts()[0] ?? (await browser.newContext());
    const page = browserContext.pages()[0] ?? (await browserContext.newPage());
    const recordingUrl = await recordingUrlFor(sessionId);

    switch (input.action) {
      case "navigate": {
        if (!input.url) throw new Error('"navigate" requires url');
        const res = await page.goto(input.url, { waitUntil: "domcontentloaded" });
        return { ok: true, status: res?.status(), title: await page.title(), recordingUrl };
      }
      case "click": {
        if (!input.selector) throw new Error('"click" requires selector');
        await page.click(input.selector);
        return { ok: true, recordingUrl };
      }
      case "type": {
        if (!input.selector || input.text == null) throw new Error('"type" requires selector and text');
        await page.fill(input.selector, input.text);
        return { ok: true, recordingUrl };
      }
      case "screenshot": {
        const buf = await page.screenshot({ type: "png" });
        return { ok: true, screenshotBase64: buf.toString("base64"), recordingUrl };
      }
      case "extract_text": {
        const text = input.selector ? await page.locator(input.selector).innerText() : await page.locator("body").innerText();
        return { ok: true, text: text.slice(0, 20_000), recordingUrl };
      }
    }
  } finally {
    // Intentionally not calling StopBrowserSessionCommand here — the session is reused across
    // every browser tool call in the run (see session.ts), so only its idle timeout/TTL ends it.
    await browser.close().catch(() => {});
  }
};

/** Exported for a future "close on run completion" path, if the idle-TTL tradeoff turns out not to be enough. */
export async function closeSession(sessionId: string) {
  await client.send(new StopBrowserSessionCommand({ browserIdentifier: BROWSER_IDENTIFIER, sessionId }));
}
