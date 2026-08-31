import { tool } from "@strands-agents/sdk";
import { a2uiCatalogPromptText, renderUiInput, type Run } from "@perch/core";
import { attachA2ui } from "./persist.js";

/**
 * Standard capability wired into every agent run (see handler.ts): the `render_ui` tool lets the
 * model draw a declarative UI card in the chat instead of describing structured data in prose. The
 * card is an A2UI document (`@perch/core`'s `a2ui.ts`) — a closed, non-executable component
 * catalog — persisted as its own message by `attachA2ui` and drawn by `@perch/ui`'s `A2uiBlock`.
 */

/** Folded into the agent's system prompt whenever `render_ui` is granted. */
export const A2UI_INSTRUCTIONS = a2uiCatalogPromptText();

export function makeRenderUiTool(run: Run) {
  return tool({
    name: "render_ui",
    description:
      "Render a structured UI card in the chat: tables, key/value lists, status badges, callouts, " +
      "checklists, buttons, forms. Use it when structured layout communicates better than a " +
      "paragraph. The card is posted as its own message, so keep any accompanying text reply " +
      "short. Pass a stable `updateKey` to keep one living card and update it in place across " +
      "turns and actions; omit it and each call posts a new card.",
    inputSchema: renderUiInput,
    callback: async ({ card, updateKey }, context) => {
      // `toolUseId` is the model-issued key that's stable across a durable-workflow replay of this
      // turn — attachA2ui uses it to upsert rather than double-post. Falls back to a constant so a
      // context-less direct call still works (and stays idempotent per run). `updateKey`, when
      // given, overrides all of that with a channel-scoped pointer so the card persists across runs.
      const renderKey = context?.toolUse.toolUseId ?? "render_ui";
      const message = await attachA2ui({ run, renderKey, updateKey, document: card });
      return { ok: true, messageId: message.id, components: card.components.length };
    },
  });
}
