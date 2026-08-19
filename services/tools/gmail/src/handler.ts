import { z } from "zod";
import { getAccessToken } from "./google-token.js";

/**
 * Reads/sends Gmail on behalf of one agent's own connected Google account — see
 * apps/desktop/src-tauri/src/google_workspace.rs (the desktop-side OAuth flow) and
 * services/api/src/routers/members.ts's `/agents/{memberId}/google-workspace/connect` (the
 * server-side token exchange + storage) for how the connection this tool reads gets created.
 * Each agent has its own independent connection; nothing here is shared/global.
 *
 * Invoked directly by Bedrock AgentCore Gateway as a lambda-type target (see infra/gateway.ts) —
 * this Lambda's `event` is the flat tool-arguments object, plus reserved `__workspaceId`/`__agentId`
 * keys that services/agent-runtime/src/tools.ts's `ApprovalInterventionHandler` injects into every
 * granted tool call before it's dispatched (this tool needs both, for the SSM lookup below) — see
 * services/tools/http-fetch's handler for the full explanation of why these ride along outside the
 * model-facing schema.
 */
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_messages"),
    query: z.string().optional().describe("Gmail search syntax, e.g. \"is:unread from:boss@co.com\""),
    maxResults: z.number().int().positive().max(50).default(10),
  }),
  z.object({
    action: z.literal("get_message"),
    messageId: z.string().min(1),
  }),
  z.object({
    action: z.literal("send"),
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
]);

const reservedContextSchema = z.object({ workspaceId: z.string(), agentId: z.string() });

function extractContext(event: Record<string, unknown>) {
  return reservedContextSchema.parse({ workspaceId: event.__workspaceId, agentId: event.__agentId });
}

function stripReservedKeys(event: Record<string, unknown>): Record<string, unknown> {
  const { __workspaceId, __agentId, __runId, ...rest } = event;
  return rest;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Walks a Gmail message payload's MIME tree for the first text/plain part — messages are
 * multipart/alternative or multipart/mixed far more often than a bare body. */
function extractPlainText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const part = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  return undefined;
}

async function callGmail(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`gmail: ${path} -> HTTP ${res.status}: ${body.slice(0, 500)}`);
    throw new Error(`Gmail API request failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

export const handler = async (rawEvent: unknown) => {
  const event = typeof rawEvent === "object" && rawEvent !== null ? (rawEvent as Record<string, unknown>) : {};
  const { workspaceId, agentId } = extractContext(event);
  const input = inputSchema.parse(stripReservedKeys(event));
  console.log(`gmail: agent=${agentId} action=${input.action}`);

  try {
    const accessToken = await getAccessToken(workspaceId, agentId);

    if (input.action === "list_messages") {
      const params = new URLSearchParams({ maxResults: String(input.maxResults) });
      if (input.query) params.set("q", input.query);
      const list = (await callGmail(accessToken, `/messages?${params}`)) as { messages?: { id: string }[] };
      const messages = await Promise.all(
        (list.messages ?? []).map(async (m) => {
          const full = (await callGmail(accessToken, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)) as {
            id: string;
            snippet?: string;
            payload?: { headers?: { name: string; value: string }[] };
          };
          const headers = full.payload?.headers ?? [];
          const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
          return { id: full.id, subject: header("Subject"), from: header("From"), date: header("Date"), snippet: full.snippet };
        }),
      );
      console.log(`gmail: list_messages -> ${messages.length} results`);
      return { messages };
    }

    if (input.action === "get_message") {
      const full = (await callGmail(accessToken, `/messages/${input.messageId}?format=full`)) as {
        id: string;
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const headers = full.payload?.headers ?? [];
      const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
      const body = extractPlainText(full.payload) ?? full.snippet ?? "";
      console.log(`gmail: get_message ${input.messageId} -> ${body.length} chars`);
      return { id: full.id, subject: header("Subject"), from: header("From"), to: header("To"), date: header("Date"), body: body.slice(0, 20_000) };
    }

    // action === "send"
    const raw = [`To: ${input.to}`, `Subject: ${input.subject}`, "Content-Type: text/plain; charset=utf-8", "", input.body].join("\r\n");
    const sent = (await callGmail(accessToken, "/messages/send", { method: "POST", body: JSON.stringify({ raw: encodeBase64Url(raw) }) })) as { id: string };
    console.log(`gmail: send -> message ${sent.id}`);
    return { sent: true, messageId: sent.id };
  } catch (err) {
    console.error(`gmail: action=${input.action} failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
};
