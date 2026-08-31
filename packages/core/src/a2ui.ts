import { z } from "zod";

/**
 * A2UI — the declarative, render-agnostic UI format an agent emits to draw a card in the chat
 * (a2ui.org). An `A2uiDocument` is a flat list of components addressed by `id` plus a `root`
 * pointer; containers (`Stack`, `Card`) reference their children by id. Nothing here is
 * executable — props are data only — so a renderer (see `@perch/ui`'s `A2uiBlock`) maps each
 * `type` to a native component and never evaluates agent-supplied code.
 *
 * This is deliberately a **closed catalog**: the component set below is the whole contract, shared
 * by the agent-side prompt (`a2uiCatalogPromptText`), the `render_ui` tool's input validation, and
 * the frontend renderer. Adding a component means touching all three on purpose. Bump
 * `A2UI_CATALOG_VERSION` whenever the shape changes so a stale client can reject a newer document
 * rather than mis-render it.
 */

export const A2UI_CATALOG_ID = "perch.core";
/** Bump whenever the component set or a prop shape changes. v2 added `Button`, v3 added
 * `Form` + `Field` (multi-field input submitted as one action). */
export const A2UI_CATALOG_VERSION = 3;

const componentId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "component id may contain only letters, digits, _ or -");

/** Shared semantic tone used by `Callout` and `StatusBadge`. */
export const a2uiTone = z.enum(["neutral", "info", "success", "warning", "danger"]);
export type A2uiTone = z.infer<typeof a2uiTone>;

const bodyText = z.string().min(1).max(2000);
const shortText = z.string().min(1).max(200);

/** URL props are limited to schemes that can't execute — no `javascript:`, no `data:`. */
const safeUrl = z
  .string()
  .url()
  .refine((u) => /^(https:\/\/|mailto:)/i.test(u), "url must be an https:// or mailto: link");

const stack = z.object({
  type: z.literal("Stack"),
  id: componentId,
  props: z
    .object({
      direction: z.enum(["vertical", "horizontal"]).default("vertical"),
      gap: z.enum(["sm", "md", "lg"]).default("md"),
    })
    .default({ direction: "vertical", gap: "md" }),
  children: z.array(componentId).max(50).default([]),
});

const card = z.object({
  type: z.literal("Card"),
  id: componentId,
  props: z.object({ title: shortText.optional() }).default({}),
  children: z.array(componentId).max(50).default([]),
});

const textComponent = z.object({
  type: z.literal("Text"),
  id: componentId,
  props: z.object({
    text: bodyText,
    tone: z.enum(["default", "muted"]).default("default"),
    weight: z.enum(["regular", "medium", "bold"]).default("regular"),
  }),
});

const heading = z.object({
  type: z.literal("Heading"),
  id: componentId,
  props: z.object({
    text: shortText,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  }),
});

const divider = z.object({
  type: z.literal("Divider"),
  id: componentId,
  props: z.object({}).default({}),
});

const keyValue = z.object({
  type: z.literal("KeyValue"),
  id: componentId,
  props: z.object({
    items: z.array(z.object({ label: shortText, value: bodyText })).min(1).max(30),
  }),
});

const table = z.object({
  type: z.literal("Table"),
  id: componentId,
  props: z.object({
    columns: z.array(shortText).min(1).max(8),
    rows: z.array(z.array(bodyText)).max(50),
  }),
});

const callout = z.object({
  type: z.literal("Callout"),
  id: componentId,
  props: z.object({ tone: a2uiTone.default("info"), title: shortText.optional(), text: bodyText }),
});

const statusBadge = z.object({
  type: z.literal("StatusBadge"),
  id: componentId,
  props: z.object({ label: shortText, tone: a2uiTone.default("neutral") }),
});

const progressList = z.object({
  type: z.literal("ProgressList"),
  id: componentId,
  props: z.object({
    items: z
      .array(z.object({ label: shortText, state: z.enum(["done", "active", "pending"]) }))
      .min(1)
      .max(30),
  }),
});

const link = z.object({
  type: z.literal("Link"),
  id: componentId,
  props: z.object({ label: shortText, url: safeUrl }),
});

/** An opaque token the agent assigns to a `Button`; echoed back verbatim when the user clicks so
 * the agent's follow-up turn knows which action fired. Same charset as a component id. */
export const a2uiActionId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "actionId may contain only letters, digits, _ or -");

const button = z.object({
  type: z.literal("Button"),
  id: componentId,
  props: z.object({
    label: shortText,
    actionId: a2uiActionId,
    variant: z.enum(["primary", "secondary"]).default("secondary"),
    /** optional payload the agent wants handed back with the click, e.g. a row key */
    value: z.string().max(500).optional(),
  }),
});

/** Field name within a `Form` — becomes a key in the `formData` the agent gets back on submit. */
const fieldName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "field name may contain only letters, digits, _ or -");

const field = z.object({
  type: z.literal("Field"),
  id: componentId,
  props: z.object({
    name: fieldName,
    label: shortText,
    placeholder: shortText.optional(),
    multiline: z.boolean().default(false),
    required: z.boolean().default(false),
  }),
});

const form = z.object({
  type: z.literal("Form"),
  id: componentId,
  props: z.object({
    actionId: a2uiActionId,
    submitLabel: shortText.default("Submit"),
  }),
  /** `Field`s to collect, plus any display components (Text, Callout, …) for context. */
  children: z.array(componentId).max(50).default([]),
});

export const a2uiComponent = z.discriminatedUnion("type", [
  stack,
  card,
  textComponent,
  heading,
  divider,
  keyValue,
  table,
  callout,
  statusBadge,
  progressList,
  link,
  button,
  field,
  form,
]);
export type A2uiComponent = z.infer<typeof a2uiComponent>;
export type A2uiComponentType = A2uiComponent["type"];

/** True if following `children` edges from `root` ever revisits a node still on the stack. */
function hasCycle(doc: { root: string; components: { id: string; children?: string[] }[] }): boolean {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const state = new Map<string, "visiting" | "done">();
  const walk = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === "visiting") return true;
    if (seen === "done") return false;
    state.set(id, "visiting");
    for (const childId of byId.get(id)?.children ?? []) {
      if (walk(childId)) return true;
    }
    state.set(id, "done");
    return false;
  };
  return walk(doc.root);
}

export const a2uiDocument = z
  .object({
    catalogId: z.literal(A2UI_CATALOG_ID),
    version: z.literal(A2UI_CATALOG_VERSION),
    root: componentId,
    components: z.array(a2uiComponent).min(1).max(100),
  })
  .refine((doc) => new Set(doc.components.map((c) => c.id)).size === doc.components.length, {
    message: "component ids must be unique",
  })
  .refine((doc) => doc.components.some((c) => c.id === doc.root), {
    message: "root must reference a component in the list",
  })
  .refine(
    (doc) => {
      const ids = new Set(doc.components.map((c) => c.id));
      return doc.components.every((c) => !("children" in c) || c.children.every((childId) => ids.has(childId)));
    },
    { message: "every child id must reference a component in the list" },
  )
  .refine((doc) => !hasCycle(doc), { message: "the component tree must not contain a cycle" });

export type A2uiDocument = z.infer<typeof a2uiDocument>;

/**
 * The form an A2UI card takes as it rides on a `message` over the wire. Deliberately shallow —
 * `components` is left as free JSON — so a typed API client (the desktop app's Rust proxy
 * generates structs from the OpenAPI doc) doesn't have to model the whole recursive catalog, which
 * the codegen can't represent. The strict shape (`a2uiDocument`) is enforced where a card is
 * produced (the `render_ui` tool) and re-validated by the renderer and the action endpoint before
 * anything trusts it.
 */
export const a2uiCard = z.object({
  catalogId: z.literal(A2UI_CATALOG_ID),
  version: z.number().int().positive(),
  root: z.string().min(1),
  components: z.array(z.unknown()).min(1).max(100),
});
export type A2uiCard = z.infer<typeof a2uiCard>;

/**
 * Input to the `render_ui` tool. `updateKey` lets an agent keep a single living card in a channel
 * — status dashboards, a form that becomes a result — instead of stacking a new message each time.
 * Reuse the same key (across turns, and after a Button/Form action) and that card updates in
 * place; omit it and every call posts a fresh card.
 */
export const renderUiInput = z.object({
  card: a2uiDocument,
  updateKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "updateKey may contain only letters, digits, _ or -")
    .optional(),
});
export type RenderUiInput = z.infer<typeof renderUiInput>;

/**
 * Compact human/LLM-readable description of the catalog, folded into an agent's system prompt by
 * `services/agent-runtime` so the model knows what it can draw and in what shape. Keep it terse —
 * it rides along on every agent turn.
 */
export function a2uiCatalogPromptText(): string {
  return [
    `## Rendering UI (\`render_ui\` tool)`,
    ``,
    `Call \`render_ui\` to draw a structured card in the chat when a table, key/value list, status,`,
    `checklist, or callout communicates better than a paragraph. The card is posted as its own`,
    `message — keep your text reply short (or skip it) when you render one. Do not use it for plain`,
    `prose; just reply normally for that.`,
    ``,
    `Tool input: { "card": <A2uiDocument>, "updateKey"?: "<slug>" }`,
    `An A2uiDocument is:`,
    `  { "catalogId": "${A2UI_CATALOG_ID}", "version": ${A2UI_CATALOG_VERSION}, "root": "<id>",`,
    `    "components": [ { "id": "<unique>", "type": "<Type>", "props": {...}, "children": ["<id>"] } ] }`,
    `Components are a flat list; containers link children by id. "root" is the top component's id.`,
    ``,
    `updateKey: pass the SAME short slug ("deploy-status", "booking-form") every time you want to`,
    `keep one living card and update it in place — across turns, and after a Button/Form action.`,
    `Omit it and each call posts a new card. Prefer updating over stacking cards.`,
    ``,
    `Components and their props:`,
    `- Stack    props { direction?: "vertical"|"horizontal", gap?: "sm"|"md"|"lg" }  + children[]`,
    `- Card     props { title?: string }                                            + children[]`,
    `- Heading  props { text: string, level?: 1|2|3 }`,
    `- Text     props { text: string, tone?: "default"|"muted", weight?: "regular"|"medium"|"bold" }`,
    `- Divider  props {}`,
    `- KeyValue props { items: [{ label: string, value: string }] }`,
    `- Table    props { columns: string[], rows: string[][] }`,
    `- Callout  props { tone: "neutral"|"info"|"success"|"warning"|"danger", title?: string, text: string }`,
    `- StatusBadge props { label: string, tone: "neutral"|"info"|"success"|"warning"|"danger" }`,
    `- ProgressList props { items: [{ label: string, state: "done"|"active"|"pending" }] }`,
    `- Link     props { label: string, url: string }   (https:// or mailto: only)`,
    `- Button   props { label: string, actionId: string, variant?: "primary"|"secondary", value?: string }`,
    `- Field    props { name: string, label: string, placeholder?: string, multiline?: bool, required?: bool }`,
    `- Form     props { actionId: string, submitLabel?: string }   + children[]  (put Fields in here)`,
    ``,
    `Interactivity: when the user clicks a Button or submits a Form, you get a follow-up turn. The`,
    `message is \`[ui-action] <label> (actionId=<actionId>)\`, followed by \`value=<value>\` for a`,
    `Button and one \`<fieldName>: <value>\` line per Field for a Form. Only add a Button/Form when you`,
    `can actually act on it in your reply (re-run a check, confirm, take the input and continue).`,
    `Pick a short stable \`actionId\` ("refresh", "approve", "book-room").`,
    ``,
    `Example:`,
    `{ "updateKey": "deploy-status", "card": {`,
    `  "catalogId": "${A2UI_CATALOG_ID}", "version": ${A2UI_CATALOG_VERSION}, "root": "root",`,
    `  "components": [`,
    `    { "id": "root", "type": "Card", "props": { "title": "Deploy status" }, "children": ["t"] },`,
    `    { "id": "t", "type": "Table", "props": { "columns": ["Service", "State"],`,
    `      "rows": [["api", "healthy"], ["web", "deploying"]] } } ] } }`,
  ].join("\n");
}
