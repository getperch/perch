import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { createReminder } from "./reminders.js";

/**
 * Standard capability wired into every agent's interactive chat turn (see handler.ts), the same
 * way `render_ui` is — not a Gateway MCP tool grant, always available, no per-agent opt-in. Covers
 * requests like "remind me to pick that up this afternoon": the agent schedules itself a one-time
 * re-run rather than needing a human to open Settings → Schedules (see reminders.ts).
 *
 * There's no per-workspace timezone setting anywhere in this codebase yet, so `runAt` is always
 * interpreted as UTC (EventBridge Scheduler's default `at()` timezone) — the description below
 * says so explicitly so the model states the UTC time back rather than silently guessing the
 * user's local offset wrong.
 */
const inputSchema = z.object({
  runAt: z
    .string()
    .describe(
      'When to fire, as "YYYY-MM-DDTHH:MM:SS" in UTC (no offset) — e.g. "2026-09-15T05:30:00". There is no ' +
        "per-user timezone configured, so convert whatever time the user meant to UTC yourself and say the " +
        "UTC (or, if you know it, their local) time back in your reply so they can correct you if it's off.",
    ),
  message: z.string().describe("What to say/do when this fires — becomes your own prompt for that run, in this same channel."),
});

export function makeCreateReminderTool(context: { workspaceId: string; agentId: string; channelId: string }) {
  return tool({
    name: "create_reminder",
    description:
      'Schedule a one-time reminder for yourself. Use this for "remind me to X later/tomorrow/at 3pm" — at ' +
      "the given time you'll run again with `message` as your prompt and post the result in this channel. " +
      "For anything recurring (daily/weekly), tell the user to set that up in Settings → Schedules instead.",
    inputSchema,
    callback: async ({ runAt, message }) => {
      const { triggerIndex } = await createReminder({ workspaceId: context.workspaceId, agentId: context.agentId, channelId: context.channelId, runAt, message });
      return { ok: true, runAt, triggerIndex };
    },
  });
}
