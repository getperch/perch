import { z } from "zod";
import { getAccessToken, CALENDAR_SCOPES } from "./google-token.js";

/**
 * Reads/creates events on the primary Google Calendar of one agent's own connected Google
 * account — see apps/desktop/src-tauri/src/google_workspace.rs (the desktop-side OAuth flow) and
 * services/api/src/routers/members.ts's `/agents/{memberId}/connectors/google-workspace/connect` (the
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
    action: z.literal("list_events"),
    timeMinIso: z.string().datetime().optional().describe("defaults to now"),
    timeMaxIso: z.string().datetime().optional(),
    maxResults: z.number().int().positive().max(50).default(10),
  }),
  z.object({
    action: z.literal("create_event"),
    summary: z.string().min(1),
    startIso: z.string().datetime(),
    endIso: z.string().datetime(),
    description: z.string().optional(),
    attendeeEmails: z.array(z.string().email()).optional(),
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

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary";

async function callCalendar(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init?.headers },
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`calendar: ${path} -> HTTP ${res.status}: ${body.slice(0, 500)}`);
    throw new Error(`Calendar API request failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

export const handler = async (rawEvent: unknown) => {
  const event = typeof rawEvent === "object" && rawEvent !== null ? (rawEvent as Record<string, unknown>) : {};
  const { workspaceId, agentId } = extractContext(event);
  const input = inputSchema.parse(stripReservedKeys(event));
  console.log(`calendar: agent=${agentId} action=${input.action}`);

  try {
    const accessToken = await getAccessToken(workspaceId, agentId, [CALENDAR_SCOPES.events]);

    if (input.action === "list_events") {
      const params = new URLSearchParams({
        maxResults: String(input.maxResults),
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: input.timeMinIso ?? new Date().toISOString(),
      });
      if (input.timeMaxIso) params.set("timeMax", input.timeMaxIso);
      const list = (await callCalendar(accessToken, `/events?${params}`)) as {
        items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink?: string }[];
      };
      const events = (list.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        link: e.htmlLink,
      }));
      console.log(`calendar: list_events -> ${events.length} results`);
      return { events };
    }

    // action === "create_event"
    const created = (await callCalendar(accessToken, "/events", {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
        attendees: input.attendeeEmails?.map((email) => ({ email })),
      }),
    })) as { id: string; htmlLink?: string };
    console.log(`calendar: create_event -> event ${created.id}`);
    return { created: true, eventId: created.id, link: created.htmlLink };
  } catch (err) {
    console.error(`calendar: action=${input.action} failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
};
