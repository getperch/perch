export const CONCISENESS_INSTRUCTIONS =
  "Keep responses short and conversational, like a chat message — a few sentences, not a report. " +
  "Never use markdown headers or bullet lists for a simple answer. " +
  'When you cite sources, do not link them inline — instead end your reply with a line that says exactly "Sources:" ' +
  "followed by one markdown link per line, e.g. [Site name](https://example.com).";

/** Appended only when the agent actually has at least one tool granted (see handler.ts) — telling
 * an agent with zero tools to "use your tools" would just be confusing.
 *
 * Deliberately blunt and mechanical, not a soft judgment-call suggestion — weaker/smaller models
 * (Nova, Llama, Mistral, etc., as opposed to Claude) are meaningfully less reliable at *proactively
 * deciding* a question needs a tool, even when the tool's own description is accurate and specific
 * (see each tool's own Gateway target description in infra/gateway.ts). A
 * concrete checklist of trigger categories and an
 * explicit "call the tool BEFORE answering" instruction compensates better for that gap than a
 * general "use good judgment" nudge does, at the cost of being a little more likely to over-call
 * tools on borderline questions — worth it, since a wrong answer from stale memory is worse.
 */
export const TOOL_USE_INSTRUCTIONS =
  "Before answering, check whether the question touches any of: scores or results, prices, schedules or " +
  "dates, who currently holds a role or position, recent news, or anything else that could have changed " +
  "since your training data was collected. If it does, you MUST call the relevant tool BEFORE writing your " +
  "answer — do not answer from memory first and only search if unsure. Do not rely on your own knowledge for " +
  "these categories even if you feel confident; your training data has a cutoff and may already be stale. " +
  "Only skip tools for questions that are clearly timeless (general explanations, definitions, math, etc.).";

const SOURCES_HEADING = /\n{1,2}\**sources:?\**\s*\n/i;
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export type FormattedResponse = { answer: string; sources: { label: string; url: string }[] };

/**
 * Splits a trailing "Sources:" section (see `CONCISENESS_INSTRUCTIONS`) off the model's raw
 * reply so it can render as its own UI element instead of inline links — and strips markdown
 * bold/bullet syntax the model sometimes uses despite being asked not to, since this app renders
 * plain text, not markdown (see ChatScreen.tsx's `renderMessageText`).
 */
export function formatAgentResponse(raw: string): FormattedResponse {
  const split = raw.split(SOURCES_HEADING);
  const body: string = split.length > 1 ? (split[0] ?? "") : raw;
  const sourcesBlock: string | undefined = split.length > 1 ? split.slice(1).join("\n") : undefined;

  const sources: FormattedResponse["sources"] = [];
  if (sourcesBlock) {
    for (const match of sourcesBlock.matchAll(MARKDOWN_LINK)) {
      const [, label, url] = match;
      if (label && url) sources.push({ label: label.replace(/\*\*/g, "").trim(), url });
    }
  }

  const answer = body
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** -> bold
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ") // markdown bullets -> plain bullet char
    .replace(/^#{1,6}[ \t]+/gm, "") // markdown headers -> plain line
    .trim();

  return { answer, sources };
}
