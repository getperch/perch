---
title: "Agent-rendered UI (A2UI)"
description: "How render_ui / A2UI cards work: the component catalog, the per-agent toggle, and how to add a component."
---

Every perch agent can draw a structured, interactive card in the chat instead of describing
data in prose. This is a standard capability — on by default for every agent, on both the
`@mention` path and scheduled runs — built on two decoupled layers:

| Layer | What it is | Where |
|---|---|---|
| **AG-UI** | Transport — the existing channel event stream carries the card | `message.created` / `message.updated` SSE |
| **A2UI** | Declarative UI format — a flat, non-executable component tree (see [a2ui.org](https://a2ui.org)) | `packages/core/src/a2ui.ts` |
| **Catalog (BYOC)** | Component *definitions* (shared, feed the prompt + validation) vs. *renderers* (frontend) | definitions in `@perch/core`, renderers in `@perch/ui` |

The agent only ever learns the catalog *shape*. It never knows it's your `<Table>` or
`<StatusBadge>` on the other end — swap the renderers, add a Slack surface later, agent
behaviour is unchanged.

## How it works end to end

1. **Emit.** The agent calls the `render_ui` tool (`services/agent-runtime/src/a2ui.ts`) with
   `{ card: <a2uiDocument>, updateKey?: <slug> }`. The catalog spec is folded into the system
   prompt by `a2uiCatalogPromptText()`, so the model knows the exact shape.
2. **Persist.** `attachA2ui()` (`services/agent-runtime/src/persist.ts`) writes the card as its
   own `message` (`message.a2ui`). Keyed by a pointer item:
   - no `updateKey` → `RUN#<runId> / A2UI#<toolUseId>` — one card per call, **replay-safe** (a
     durable-workflow replay updates the same message instead of duplicating).
   - `updateKey` set → `CHANNEL#<id> / A2UIKEY#<agentId>#<updateKey>` — one **living card** the
     agent updates in place across turns and follow-up action runs (a status dashboard, a form
     that becomes a result). Scoped per agent.
3. **Deliver.** The message rides the normal channel SSE stream — no new event type.
4. **Render.** `A2uiBlock` (`packages/ui/src/a2ui/A2uiBlock.tsx`) re-validates the card against
   the strict `a2uiDocument` and draws it with Perch design tokens. A malformed card, or one
   built with a newer catalog version, degrades to a one-line note — it never throws.
5. **Interact** (optional). Clicking a `Button` or submitting a `Form` `POST`s to
   `/channels/{id}/a2ui-actions`. The API re-validates the action against the card's declared
   `Button`/`Form` (an agent can only be driven by what it put on its own card), then posts a
   user message carrying an `a2uiAction` `{ sourceMessageId, actionId, label, value }` — the chat
   renders this as a compact `⚡ <label>` chip; the message's `text` is the agent-facing prompt
   (`[ui-action] <label> (actionId=…)` plus `value=…` / `<field>: <value>` lines). It then starts
   a follow-up `direct` turn for the authoring agent. Form field values are validated against the
   form's declared `Field`s (unknown names dropped, `required` enforced).

## The catalog (v3)

Read-only: `Stack`, `Card`, `Heading`, `Text`, `Divider`, `KeyValue`, `Table`, `Callout`,
`StatusBadge`, `ProgressList`, `Link`.
Interactive:
- `Button` (`{ label, actionId, variant?, value? }`) — one-click action.
- `Form` (`{ actionId, submitLabel? }` + children) wrapping `Field`s
  (`{ name, label, placeholder?, multiline?, required? }`) — collect several values, submit as one
  action. The agent gets `<fieldName>: <value>` lines in its follow-up turn.

An `a2uiDocument` is `{ catalogId, version, root, components[] }` — a flat list where containers
(`Stack`, `Card`) reference children by id. See `a2uiCatalogPromptText()` for the exact
per-component props and a worked example (it's the same text the model sees).

Props are **data only**. `Link` URLs are restricted to `https:` / `mailto:`. The document is
validated for unique ids, resolvable child refs, and the absence of cycles.

`message.a2ui` on the wire is the *shallow* `a2uiCard` (components left as free JSON) so the
typed desktop API client doesn't have to model the recursive catalog. The strict shape is
enforced where a card is **produced** (`render_ui`), **rendered** (`A2uiBlock` re-parses), and
where an **action** is received (the endpoint re-parses before trusting `actionId`).

## Turning it off

Per agent: **Agent detail → Chat UI cards → Off** (`config.ui.enabled`, absent = on). With it
off, the agent gets neither the `render_ui` tool nor the catalog prompt text.

## Adding a component

The catalog is deliberately closed — a change touches three places on purpose:

1. **Definition** — add the zod branch to the discriminated union in `packages/core/src/a2ui.ts`
   and a line to `a2uiCatalogPromptText()`. Bump `A2UI_CATALOG_VERSION` (any shape change is a
   version bump; older/newer clients then fall back cleanly).
2. **Renderer** — add a `case` to the `switch` in `packages/ui/src/a2ui/A2uiBlock.tsx`, reading
   props defensively (`str()` / `asArray()` helpers) and using design tokens.
3. **Tests** — extend `packages/core/src/a2ui.test.ts` (schema) and
   `packages/ui/src/a2ui/A2uiBlock.test.tsx` (render + fallback).

If the wire shape of `message.a2ui` changes (rare — `components` is opaque JSON there), also run
`pnpm --filter @perch/api generate-openapi` and rebuild the desktop Rust proxy.

## Not yet

Shared state (`STATE_SNAPSHOT`/`STATE_DELTA`), streaming partial cards, and alignment with the
A2UI v1.0 RPC spec. See `docs/plans/agui-a2ui.md`.
