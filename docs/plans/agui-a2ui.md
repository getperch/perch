# Plan: AG-UI / A2UI as a standard capability for every perch agent

## Goal

Every agent can render and (eventually) drive interactive UI in the chat, not just post
text — as a default part of the platform, not a per-agent bolt-on. Achieved with two
decoupled layers so the agent never knows *how* its UI renders:

| Layer | Role | Spec |
|---|---|---|
| **AG-UI** | Transport — events between agent run and app | ag-ui-protocol |
| **A2UI** | Declarative UI format — flat, streamable component-tree JSON (`application/a2ui+json`) | a2ui.org, v0.9.1 |
| **Catalog (BYOC)** | `definitions` (shared, feed the prompt + validate) + `renderers` (frontend only) | A2UI catalog concept |

## How it maps onto today's code

- Agents run in `services/agent-runtime/src/handler.ts` on `@strands-agents/sdk`, inside an
  SST durable workflow that **replays the reasoning turn on crash**.
- Output today = a persisted `Message` row (`packages/core/src/message.ts`) with `text` +
  `citations` + optional `approval`/`artifact`, plus a `RunStep` timeline.
- Delivery = `appendChannelEvent` → DynamoDB append log → `GET /channels/{id}/events` SSE
  (`services/api/src/routers/channel-events.ts`) → Tauri Rust poller → `useChannelStream`
  → zod-validated `channelStreamEvent` (`packages/api-contract/src/stream.ts`).
- Human-in-the-loop already exists: `ApprovalInterventionHandler` +
  `ctx.createCallback()` (24h suspend) + `POST /approvals/{id}/resolve` +
  `resolveDurableCallback`. **The interactivity phase mirrors this exactly.**

Design decision: **A2UI content lives ON a `Message`** (new `message.a2ui` field, parallel
to `artifact`/`approval`). Fits the audit-everything posture, reuses the existing
`message.created` / `message.updated` stream variants, survives reload. Ephemeral
run-scoped UI is rejected.

---

## Phase 0 — Spike & de-risk (~2 days, no production code)

1. **Renderer decoupling.** Stand up the A2UI React renderer in a throwaway Vite page and
   confirm it runs without `@copilotkit/react-core` at runtime. Outcomes ranked:
   (a) `@copilotkit/a2ui-renderer` usable standalone → depend on it;
   (b) not → write our own ~300-line renderer against the spec (viable because our catalog
   is a *closed* set); (c) vendor a fork.
2. **Pin the spec.** Target **v0.9.1 (read-only generative UI)** for the first ship.
   v1.0-RC (client→server RPC + action IDs) is Phase 4 only.
3. **Confirm wire format** from `a2ui-project/a2ui` `docs/public/` — the flat component
   list with id refs + root, and the `generate_a2ui` tool schema.
4. **Transport decision** (recommend: extend `channelStreamEvent`, no new endpoint).

Exit criteria: a hand-written A2UI JSON doc renders in a standalone React page using
perch design primitives.

---

## Phase 1 — Catalog & contract  (`@perch/api-contract`, `@perch/core`)

- **`packages/api-contract/src/a2ui.ts`** (new):
  - `a2uiComponentDefinition` — `{ name, description, props: <JSON Schema> }`.
  - `perchCatalog` — start with ~8 read-only components:
    `Stack`, `Text`, `Card`, `KeyValue`, `Table`, `Callout`, `StatusBadge`, `ProgressList`.
  - `a2uiDocument` — zod for the emitted tree (flat `components[]` with `id`, `type`,
    `props`, `children` refs, + `root`). Validated on ingest **and** in the renderer.
  - `CATALOG_ID` + `CATALOG_VERSION` consts.
- **`packages/core/src/message.ts`**: add `a2ui: a2uiDocument.optional()` to `message`.
- **`packages/api-contract/src/stream.ts`**: no new variant needed — `message.created` /
  `message.updated` already carry the whole `message`, so an A2UI update = re-emit the
  message. (Fine-grained streaming deltas deferred to Phase 4.)
- Golden test: serialized `perchCatalog` prompt text stays under a set token budget.

---

## Phase 2 — Agent emit  (`services/agent-runtime`)

- **`services/agent-runtime/src/a2ui.ts`** (new): a native Strands `tool()` named
  `render_ui`:
  - input = an `a2uiDocument` (validated with the shared zod).
  - handler calls new `persist.ts` fn `attachA2ui({ run, toolUseId, document })` →
    upserts a `Message` with `a2ui` set, emits `message.created` / `message.updated`.
  - **Replay idempotency (main correctness risk):** derive the message id
    deterministically from `(runId, toolUseId)` so a workflow replay upserts the same row
    instead of double-posting. Same guarantee `appendRunStep` needs.
- **`handler.ts`**:
  - add `renderUiTool` to the `strandsAgent` `tools` array **unconditionally** (this is
    what makes it "standard").
  - append `A2UI_INSTRUCTIONS` + serialized `perchCatalog` to the `systemPrompt` string
    (next to `CONCISENESS_INSTRUCTIONS` / `TOOL_USE_INSTRUCTIONS`), unless
    `agent.config.ui.enabled === false`.
- `render_ui` calls flow through `ApprovalInterventionHandler.afterToolCall` for free →
  they already show up as `tool_call` run steps.

---

## Phase 3 — Frontend renderer  (`apps/desktop`)

- **`apps/desktop/src/a2ui/catalog.tsx`**: `CatalogRenderers` — one React component per
  catalog definition, built on perch's existing design-system primitives (BYOC).
- **`apps/desktop/src/a2ui/A2uiMessage.tsx`**: resolves the flat component list and
  renders via the catalog. Unknown `type` → render children / placeholder, **never throw**.
- Mount it in the message renderer (locate in `App.tsx`) beneath `text`.
- `stream.ts` needs no change — widened `channelStreamEvent` flows through the existing
  `safeParse`.
- **Safety:** closed component set; props are data only; no `dangerouslySetInnerHTML`;
  URL props allowlisted to `https:` / `mailto:`; no agent-supplied CSS. (A2UI's core
  no-arbitrary-code guarantee + our own belt.)
- Snapshot test per catalog component; fallback test for unknown type.

---

## Phase 4 — Interactivity / round-trip  (depends on A2UI v1.0-RC)

- Adopt A2UI **action IDs**. A rendered component (button, form submit) produces an
  action event.
- **`POST /channels/{id}/a2ui-action`** (new router) — structurally a copy of
  `approvals/{id}/resolve`: validates, appends a stream event, resolves a durable callback.
- Agent side, two options — **start with (a):**
  (a) the action arrives as a follow-up user turn on the run (no long suspend);
  (b) `render_ui` optionally *blocks* on `ctx.createCallback()` like `requestApproval`
      does, for true modal forms.
- `STATE_SNAPSHOT` / `STATE_DELTA` shared state: optional, only if a concrete feature
  needs it.

---

## Phase 5 — Make it the standard offering

- `agent.config.ui = { enabled: true (default), catalogId }`.
- Expose in agent creation UI + platform docs; default new agents on.
- Grow catalog coverage; version it; keep renderer logic entirely out of `@perch/core`
  so a future Slack / web surface renders the same documents.
- Per-workspace feature flag for rollout; dogfood on one agent first.

---

## Cross-cutting

- **Testing:** contract round-trip (emit → zod → render), unknown-component fallback,
  **replay idempotency**, per-component snapshots.
- **Observability:** `render_ui` call count + document size as metrics; already visible as
  run steps.
- **Security review** before Phase 3 ships: closed catalog, data-only props, URL
  allowlist, no code path from agent output to execution.

## Open decisions for you

1. Ship read-only on **v0.9.1** now, or wait for **v1.0** and build interactivity in one pass?
2. Transport: extend `channelStreamEvent` (recommended) vs. dedicated `agent.ui` event/endpoint?
3. Renderer: depend on `@copilotkit/a2ui-renderer` / vendor it / write our own thin one?
4. A2UI on a persisted `Message` (recommended) vs. ephemeral run-scoped UI?

## Rough effort

Phase 0: ~2d · Phase 1: ~2d · Phase 2: ~3d · Phase 3: ~4d · Phase 4: ~4d (after v1.0) ·
Phase 5: ongoing. First user-visible generative UI ≈ **1.5–2 weeks** through Phase 3.
