import { describe, expect, it } from "vitest";
import {
  A2UI_CATALOG_ID,
  A2UI_CATALOG_VERSION,
  a2uiCard,
  a2uiCatalogPromptText,
  a2uiComponent,
  a2uiDocument,
  renderUiInput,
} from "./a2ui.js";

const doc = (components: unknown[], root = "root") => ({
  catalogId: A2UI_CATALOG_ID,
  version: A2UI_CATALOG_VERSION,
  root,
  components,
});

const validDoc = doc([
  { id: "root", type: "Stack", children: ["card", "badge"] },
  { id: "card", type: "Card", props: { title: "Deploy" }, children: ["table"] },
  { id: "table", type: "Table", props: { columns: ["Service", "State"], rows: [["api", "healthy"]] } },
  { id: "badge", type: "StatusBadge", props: { label: "deploying", tone: "warning" } },
]);

describe("a2uiDocument", () => {
  it("accepts a well-formed document and fills component defaults", () => {
    const parsed = a2uiDocument.parse(validDoc);
    const stack = parsed.components.find((c) => c.id === "root");
    expect(stack).toMatchObject({ type: "Stack", props: { direction: "vertical", gap: "md" } });
  });

  it("rejects a child id that references no component", () => {
    const res = a2uiDocument.safeParse(doc([{ id: "root", type: "Card", props: {}, children: ["ghost"] }]));
    expect(res.success).toBe(false);
  });

  it("rejects duplicate component ids", () => {
    const dup = { id: "root", type: "Divider", props: {} };
    expect(a2uiDocument.safeParse(doc([dup, dup])).success).toBe(false);
  });

  it("rejects a root that is not in the component list", () => {
    expect(a2uiDocument.safeParse({ ...validDoc, root: "nope" }).success).toBe(false);
  });

  it("rejects a cycle in the component tree", () => {
    const cyclic = doc(
      [
        { id: "a", type: "Stack", children: ["b"] },
        { id: "b", type: "Stack", children: ["a"] },
      ],
      "a",
    );
    expect(a2uiDocument.safeParse(cyclic).success).toBe(false);
  });

  it("rejects an unknown component type", () => {
    expect(a2uiDocument.safeParse(doc([{ id: "root", type: "Wormhole", props: {} }])).success).toBe(false);
  });

  it("rejects a wrong catalog version", () => {
    expect(a2uiDocument.safeParse({ ...validDoc, version: A2UI_CATALOG_VERSION + 1 }).success).toBe(false);
  });

  it("rejects an empty component list", () => {
    expect(a2uiDocument.safeParse(doc([])).success).toBe(false);
  });
});

describe("renderUiInput (render_ui tool input)", () => {
  const card = validDoc;

  it("wraps a card and accepts an optional updateKey", () => {
    expect(renderUiInput.safeParse({ card }).success).toBe(true);
    expect(renderUiInput.safeParse({ card, updateKey: "deploy-status" }).success).toBe(true);
  });

  it("rejects a missing card and a malformed updateKey", () => {
    expect(renderUiInput.safeParse({ updateKey: "x" }).success).toBe(false);
    expect(renderUiInput.safeParse({ card, updateKey: "has spaces" }).success).toBe(false);
  });
});

describe("a2uiCard (shallow wire form)", () => {
  it("accepts a card without validating component internals", () => {
    const res = a2uiCard.safeParse(doc([{ id: "root", type: "AnythingReally", whatever: 1 }]));
    expect(res.success).toBe(true);
  });

  it("still requires the catalog id, a root, and at least one component", () => {
    expect(a2uiCard.safeParse({ ...validDoc, catalogId: "someone-elses" }).success).toBe(false);
    expect(a2uiCard.safeParse({ ...validDoc, components: [] }).success).toBe(false);
    expect(a2uiCard.safeParse({ ...validDoc, root: "" }).success).toBe(false);
  });
});

describe("Button component (interactivity)", () => {
  const btn = (props: unknown) => a2uiComponent.safeParse({ id: "b", type: "Button", props });

  it("accepts a button with a label and a well-formed actionId", () => {
    const res = btn({ label: "Refresh", actionId: "refresh" });
    expect(res.success).toBe(true);
    if (res.success && res.data.type === "Button") expect(res.data.props.variant).toBe("secondary");
  });

  it("carries an optional value payload", () => {
    expect(btn({ label: "Pick", actionId: "pick-row", value: "row-3" }).success).toBe(true);
  });

  it("rejects an actionId with disallowed characters", () => {
    expect(btn({ label: "x", actionId: "bad id!" }).success).toBe(false);
  });

  it("is part of the current-version document", () => {
    const res = a2uiDocument.safeParse(
      doc([{ id: "root", type: "Button", props: { label: "Go", actionId: "go" } }]),
    );
    expect(res.success).toBe(true);
  });
});

describe("Form + Field components (interactivity)", () => {
  it("accepts a Form containing Fields", () => {
    const res = a2uiDocument.safeParse(
      doc(
        [
          { id: "f", type: "Form", props: { actionId: "book", submitLabel: "Book" }, children: ["name", "when"] },
          { id: "name", type: "Field", props: { name: "guest", label: "Name", required: true } },
          { id: "when", type: "Field", props: { name: "date", label: "Date", placeholder: "YYYY-MM-DD" } },
        ],
        "f",
      ),
    );
    expect(res.success).toBe(true);
    if (res.success && res.data.components[0]!.type === "Form") {
      expect(res.data.components[0]!.props.submitLabel).toBe("Book");
    }
  });

  it("defaults submitLabel and rejects a bad field name", () => {
    const okForm = a2uiComponent.safeParse({ id: "f", type: "Form", props: { actionId: "x" }, children: [] });
    expect(okForm.success && okForm.data.type === "Form" && okForm.data.props.submitLabel).toBe("Submit");
    expect(a2uiComponent.safeParse({ id: "x", type: "Field", props: { name: "bad name", label: "L" } }).success).toBe(false);
  });
});

describe("Link component url safety", () => {
  const link = (url: string) => a2uiComponent.safeParse({ id: "l", type: "Link", props: { label: "x", url } });

  it("allows https and mailto", () => {
    expect(link("https://example.com/x").success).toBe(true);
    expect(link("mailto:a@b.com").success).toBe(true);
  });

  it("blocks javascript:, data:, and http:", () => {
    expect(link("javascript:alert(1)").success).toBe(false);
    expect(link("data:text/html,<script>1</script>").success).toBe(false);
    expect(link("http://example.com").success).toBe(false);
  });
});

describe("a2uiCatalogPromptText", () => {
  const text = a2uiCatalogPromptText();

  it("names every component type in the catalog so the model knows the full set", () => {
    for (const type of [
      "Stack",
      "Card",
      "Heading",
      "Text",
      "Divider",
      "KeyValue",
      "Table",
      "Callout",
      "StatusBadge",
      "ProgressList",
      "Link",
      "Button",
      "Field",
      "Form",
    ]) {
      expect(text).toContain(type);
    }
  });

  it("states the current catalog id and version", () => {
    expect(text).toContain(A2UI_CATALOG_ID);
    expect(text).toContain(String(A2UI_CATALOG_VERSION));
  });
});
