import type { ToolGrant } from "./member.js";

/**
 * Least-privilege Google OAuth scopes, derived from which tools an agent was actually granted —
 * so connecting Google for an agent that only has the `calendar` tool never asks the human for
 * Gmail access, and vice versa. The desktop app builds Google's authorize URL from this set (via
 * `GET /members/agents/{memberId}/connectors/google-workspace/authorize`), and the gmail/calendar
 * tool Lambdas assert their own required scope is present on the refreshed token before calling Google.
 *
 * Kept here in `@perch/core` so services/api and services/agent-runtime share one definition; the
 * tool Lambdas (services/tools/*) re-derive the same three constants locally, matching the
 * "no shared package with services/tools, duplicate deliberately, keep in sync" convention already
 * used for the SSM path templates (see services/tools/gmail/src/google-token.ts).
 */
export const GOOGLE_SCOPE_GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_SCOPE_CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";

/** Every scope any tool in this app can ask for — the ceiling a connection's granted set is
 * validated against, and the fallback set when no specific agent is in scope. */
export const ALL_GOOGLE_SCOPES = [GOOGLE_SCOPE_GMAIL_READONLY, GOOGLE_SCOPE_GMAIL_SEND, GOOGLE_SCOPE_CALENDAR_EVENTS] as const;

/**
 * The minimal scope set an agent with these tool grants needs. `gmail` pulls in read + send
 * (the tool exposes both; there's no read-only gmail grant to distinguish), `calendar` pulls in
 * `calendar.events` (covers both listing and creating events). Any other tool contributes nothing.
 */
export function googleScopesForGrants(grants: Pick<ToolGrant, "toolName">[]): string[] {
  const scopes = new Set<string>();
  for (const { toolName } of grants) {
    if (toolName === "gmail") {
      scopes.add(GOOGLE_SCOPE_GMAIL_READONLY);
      scopes.add(GOOGLE_SCOPE_GMAIL_SEND);
    } else if (toolName === "calendar") {
      scopes.add(GOOGLE_SCOPE_CALENDAR_EVENTS);
    }
  }
  return [...scopes];
}
