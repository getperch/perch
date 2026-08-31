import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A2UI_CATALOG_ID, A2UI_CATALOG_VERSION, type A2uiDocument } from "@perch/core";
import { A2uiBlock } from "./A2uiBlock.js";

const render = (doc: A2uiDocument) => renderToStaticMarkup(<A2uiBlock doc={doc} />);

const baseDoc: A2uiDocument = {
  catalogId: A2UI_CATALOG_ID,
  version: A2UI_CATALOG_VERSION,
  root: "root",
  components: [
    { id: "root", type: "Card", props: { title: "Deploy status" }, children: ["table", "link"] },
    {
      id: "table",
      type: "Table",
      props: { columns: ["Service", "State"], rows: [["api", "healthy"]] },
    },
    { id: "link", type: "Link", props: { label: "Open dashboard", url: "https://example.com" } },
  ],
} as A2uiDocument;

describe("A2uiBlock", () => {
  it("renders the component tree from root", () => {
    const html = render(baseDoc);
    expect(html).toContain("Deploy status");
    expect(html).toContain("Service");
    expect(html).toContain("healthy");
    expect(html).toContain('href="https://example.com"');
  });

  it("falls back quietly on a newer catalog version instead of rendering the tree", () => {
    const html = render({ ...baseDoc, version: A2UI_CATALOG_VERSION + 1 } as A2uiDocument);
    expect(html).toContain("newer version");
    expect(html).not.toContain("Deploy status");
  });

  it("falls back (does not throw) on a document that fails strict validation", () => {
    const malformed = {
      ...baseDoc,
      components: [
        { id: "root", type: "Stack", children: ["mystery"] },
        { id: "mystery", type: "Hologram", props: {} },
      ],
    } as unknown as A2uiDocument;
    let html = "";
    expect(() => {
      html = render(malformed);
    }).not.toThrow();
    expect(html).toContain("newer version");
    expect(html).not.toContain("Service");
  });

  it("falls back on a dangling child id rather than rendering a partial tree", () => {
    const dangling = {
      ...baseDoc,
      components: [
        { id: "root", type: "Stack", children: ["ok", "ghost"] },
        { id: "ok", type: "Text", props: { text: "present" } },
      ],
    } as unknown as A2uiDocument;
    expect(() => render(dangling)).not.toThrow();
    expect(render(dangling)).toContain("newer version");
  });

  it("does not throw on entirely junk input", () => {
    expect(() => render({} as unknown as A2uiDocument)).not.toThrow();
    expect(() => render({ components: 5 } as unknown as A2uiDocument)).not.toThrow();
  });

  it("renders a Form with its fields; submit is disabled without a handler", () => {
    const withForm = {
      catalogId: A2UI_CATALOG_ID,
      version: A2UI_CATALOG_VERSION,
      root: "f",
      components: [
        { id: "f", type: "Form", props: { actionId: "book", submitLabel: "Book it" }, children: ["g", "d"] },
        { id: "g", type: "Field", props: { name: "guest", label: "Guest name", required: true } },
        { id: "d", type: "Field", props: { name: "date", label: "Date", placeholder: "YYYY-MM-DD" } },
      ],
    } as A2uiDocument;

    const inert = renderToStaticMarkup(<A2uiBlock doc={withForm} />);
    expect(inert).toContain("Guest name");
    expect(inert).toContain('placeholder="YYYY-MM-DD"');
    expect(inert).toContain("Book it");
    expect(inert).toContain("disabled");

    const live = renderToStaticMarkup(<A2uiBlock doc={withForm} onAction={() => {}} />);
    expect(live).toContain("Book it");
  });

  it("renders a Button and enables it only when an action handler is wired", () => {
    const withButton = {
      catalogId: A2UI_CATALOG_ID,
      version: A2UI_CATALOG_VERSION,
      root: "b",
      components: [{ id: "b", type: "Button", props: { label: "Re-run check", actionId: "rerun" } }],
    } as A2uiDocument;

    const inert = renderToStaticMarkup(<A2uiBlock doc={withButton} />);
    expect(inert).toContain("Re-run check");
    expect(inert).toContain("disabled");

    const live = renderToStaticMarkup(<A2uiBlock doc={withButton} onAction={() => {}} />);
    expect(live).toContain("Re-run check");
    expect(live).not.toContain("disabled");
  });
});
