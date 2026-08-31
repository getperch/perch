import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { a2uiDocument, type A2uiCard, type A2uiComponent, type A2uiDocument, type A2uiTone } from "@perch/core";
import { color, font, radius } from "../tokens.js";

/** Fired when the viewer clicks an A2UI `Button` or submits a `Form`. The host turns this into a
 * follow-up agent turn (see `POST /channels/{id}/a2ui-actions`). Absent → controls render inert. */
export type A2uiActionHandler = (action: {
  actionId: string;
  label: string;
  value?: string;
  formData?: Record<string, string>;
}) => void;

/**
 * Renderer for an {@link A2uiDocument} — the declarative UI card an agent emits via the `render_ui`
 * tool (`@perch/core`'s `a2ui.ts`). This is the "bring your own components" half of the contract:
 * the agent only knows the catalog *shape*, this file decides how each `type` looks, built on the
 * Perch design tokens. It is intentionally a closed `switch` — an unknown `type` or a dangling id
 * degrades to a quiet fallback rather than throwing, so a newer agent can never break the chat.
 */

const MAX_DEPTH = 20;

const toneStyles: Record<A2uiTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: color.surfaceMuted, fg: color.mutedDark, border: color.border },
  info: { bg: color.accentTint, fg: color.accentText, border: color.agentTagBorder },
  success: { bg: color.statusDoneBg, fg: color.statusDoneFg, border: color.statusDoneBg },
  warning: { bg: color.statusInProgressBg, fg: color.statusInProgressFg, border: color.statusInProgressBg },
  danger: { bg: color.statusDeclinedBg, fg: color.statusDeclinedFg, border: color.statusDeclinedBg },
};

const gapPx = { sm: 6, md: 10, lg: 16 } as const;

/**
 * `doc` arrives as the shallow wire form (`A2uiCard`) — this is the one place on the client that
 * re-validates it against the strict `a2uiDocument`. A card the agent built with a newer catalog,
 * or a malformed one, fails that parse and degrades to a quiet note rather than a broken card or a
 * thrown render.
 */
export function A2uiBlock({ doc, onAction }: { doc: A2uiCard | A2uiDocument; onAction?: A2uiActionHandler }) {
  const parsed = a2uiDocument.safeParse(doc);
  if (!parsed.success) {
    return <FallbackNote>This card was built for a newer version of the app.</FallbackNote>;
  }
  const document: A2uiDocument = parsed.data;

  const byId = new Map(document.components.map((c) => [c.id, c]));

  const renderNode = (id: string, depth: number, seen: ReadonlySet<string>): ReactNode => {
    if (depth > MAX_DEPTH || seen.has(id)) return null;
    const node = byId.get(id);
    if (!node) return null;
    const nextSeen = new Set(seen).add(id);
    const childIds: string[] = "children" in node ? (node.children ?? []) : [];
    const childNodes = childIds.map((cid) => byId.get(cid)).filter((c): c is A2uiComponent => !!c);
    const renderChildren = () =>
      childIds.map((childId) => <Fragment key={childId}>{renderNode(childId, depth + 1, nextSeen)}</Fragment>);
    const renderChild = (childId: string) => renderNode(childId, depth + 1, nextSeen);
    return (
      <A2uiNode
        node={node}
        childNodes={childNodes}
        renderChildren={renderChildren}
        renderChild={renderChild}
        onAction={onAction}
      />
    );
  };

  return (
    <div style={{ marginTop: 10, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 12, background: color.surface }}>
      {renderNode(document.root, 0, new Set())}
    </div>
  );
}

function A2uiNode({
  node,
  childNodes,
  renderChildren,
  renderChild,
  onAction,
}: {
  node: A2uiComponent;
  /** This node's resolved child components, in order (missing ids already dropped). */
  childNodes: A2uiComponent[];
  /** Render every child of this node. */
  renderChildren: () => ReactNode;
  /** Render one specific child by id (used by `Form` to interleave its own field inputs). */
  renderChild: (childId: string) => ReactNode;
  onAction?: A2uiActionHandler;
}) {
  // `props` / `children` are always present on a schema-validated document (each catalog entry
  // defaults them), but this renderer never assumes valid input — a malformed card degrades, it
  // doesn't throw. Hence the `?? {}` / `?? []` fallbacks throughout.
  const props: Record<string, unknown> = (node.props as Record<string, unknown> | undefined) ?? {};

  switch (node.type) {
    case "Stack": {
      const direction = props.direction === "horizontal" ? "horizontal" : "vertical";
      const gap = (props.gap as "sm" | "md" | "lg") || "md";
      return (
        <div
          style={{
            display: "flex",
            flexDirection: direction === "horizontal" ? "row" : "column",
            gap: gapPx[gap] ?? gapPx.md,
            flexWrap: direction === "horizontal" ? "wrap" : "nowrap",
          }}
        >
          {renderChildren()}
        </div>
      );
    }
    case "Card":
      return (
        <div style={{ border: `1px solid ${color.borderLight}`, borderRadius: radius.md, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {typeof props.title === "string" && <div style={{ fontSize: 13, fontWeight: 600, color: color.ink }}>{props.title}</div>}
          {renderChildren()}
        </div>
      );
    case "Heading": {
      const level = props.level === 1 ? 1 : props.level === 3 ? 3 : 2;
      const size = level === 1 ? 16 : level === 3 ? 12.5 : 14;
      return <div style={{ fontSize: size, fontWeight: 600, color: color.ink, lineHeight: 1.4 }}>{str(props.text)}</div>;
    }
    case "Text": {
      const weight = props.weight === "bold" ? 700 : props.weight === "medium" ? 600 : 400;
      return (
        <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", fontWeight: weight, color: props.tone === "muted" ? color.muted : color.ink }}>
          {str(props.text)}
        </div>
      );
    }
    case "Divider":
      return <div style={{ height: 1, background: color.borderLight, margin: "2px 0" }} />;
    case "KeyValue":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 14, rowGap: 6 }}>
          {asArray<{ label: unknown; value: unknown }>(props.items).map((item, i) => (
            <Fragment key={i}>
              <div style={{ fontSize: 12.5, color: color.muted }}>{str(item?.label)}</div>
              <div style={{ fontSize: 12.5, color: color.ink, whiteSpace: "pre-wrap" }}>{str(item?.value)}</div>
            </Fragment>
          ))}
        </div>
      );
    case "Table": {
      const columns = asArray<unknown>(props.columns);
      const rows = asArray<unknown[]>(props.rows);
      return (
        <div style={{ overflowX: "auto", border: `1px solid ${color.borderLight}`, borderRadius: radius.sm }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr>
                {columns.map((col, i) => (
                  <th key={i} style={thStyle}>{str(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {columns.map((_, ci) => (
                    <td key={ci} style={tdStyle}>{str(asArray<unknown>(row)[ci])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "Callout": {
      const t = toneStyles[tone(props.tone)];
      return (
        <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: radius.md, padding: "9px 12px" }}>
          {typeof props.title === "string" && <div style={{ fontSize: 12.5, fontWeight: 700, color: t.fg, marginBottom: 3 }}>{props.title}</div>}
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.fg, whiteSpace: "pre-wrap" }}>{str(props.text)}</div>
        </div>
      );
    }
    case "StatusBadge": {
      const t = toneStyles[tone(props.tone)];
      return (
        <span style={{ display: "inline-flex", alignItems: "center", alignSelf: "flex-start", height: 20, padding: "0 8px", borderRadius: radius.pill, background: t.bg, color: t.fg, border: `1px solid ${t.border}`, fontSize: 11.5, fontWeight: 600 }}>
          {str(props.label)}
        </span>
      );
    }
    case "ProgressList":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {asArray<{ label: unknown; state: unknown }>(props.items).map((item, i) => {
            const state = item?.state === "done" ? "done" : item?.state === "active" ? "active" : "pending";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span aria-hidden style={{ width: 14, flex: "none", textAlign: "center", color: state === "done" ? color.statusDoneFg : state === "active" ? color.accentText : color.mutedLight }}>
                  {state === "done" ? "✓" : state === "active" ? "◐" : "○"}
                </span>
                <span style={{ color: state === "pending" ? color.muted : color.ink, textDecoration: state === "done" ? "line-through" : "none" }}>{str(item?.label)}</span>
              </div>
            );
          })}
        </div>
      );
    case "Link": {
      const url = typeof props.url === "string" && /^(https:\/\/|mailto:)/i.test(props.url) ? props.url : undefined;
      if (!url) return null;
      return (
        <a href={url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12.5, color: color.accentText, fontWeight: 600 }}>
          {str(props.label) || url}
        </a>
      );
    }
    case "Button": {
      const actionId = typeof props.actionId === "string" ? props.actionId : "";
      const label = str(props.label) || "Continue";
      const value = typeof props.value === "string" ? props.value : undefined;
      const primary = props.variant === "primary";
      // No handler wired (e.g. a preview surface) or a malformed actionId → show it, but inert.
      const disabled = !onAction || !actionId;
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={disabled ? undefined : () => onAction!({ actionId, label, value })}
          style={{
            alignSelf: "flex-start",
            height: 30,
            padding: "0 14px",
            borderRadius: radius.md,
            border: primary ? "none" : `1px solid ${color.borderStrong}`,
            background: primary ? color.dark : color.surface,
            color: primary ? "#fff" : color.ink,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {label}
        </button>
      );
    }
    case "Field":
      // A Field on its own (not inside a Form) has nowhere to submit — show it read-only so the
      // layout still makes sense.
      return <FieldInput label={str(props.label)} placeholder={str(props.placeholder)} multiline={props.multiline === true} value="" onChange={undefined} />;
    case "Form": {
      const actionId = typeof props.actionId === "string" ? props.actionId : "";
      const submitLabel = str(props.submitLabel) || "Submit";
      const fields = childNodes.filter((c): c is Extract<A2uiComponent, { type: "Field" }> => c.type === "Field");
      return (
        <A2uiForm
          actionId={actionId}
          submitLabel={submitLabel}
          fields={fields.map((f) => f.props)}
          otherChildren={childNodes.filter((c) => c.type !== "Field").map((c) => <Fragment key={c.id}>{renderChild(c.id)}</Fragment>)}
          onAction={onAction}
        />
      );
    }
    default:
      return null;
  }
}

function FieldInput({
  label,
  placeholder,
  multiline,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  multiline?: boolean;
  value: string;
  onChange?: (v: string) => void;
}) {
  const shared: CSSProperties = {
    width: "100%",
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.md,
    padding: "6px 9px",
    fontSize: 12.5,
    fontFamily: font.sans,
    color: color.ink,
    background: onChange ? color.surface : color.surfaceMuted,
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11.5, color: color.muted }}>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          placeholder={placeholder || undefined}
          value={value}
          disabled={!onChange}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          style={{ ...shared, resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          placeholder={placeholder || undefined}
          value={value}
          disabled={!onChange}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          style={shared}
        />
      )}
    </label>
  );
}

type FieldProps = { name: string; label: string; placeholder?: string; multiline: boolean; required: boolean };

function A2uiForm({
  actionId,
  submitLabel,
  fields,
  otherChildren,
  onAction,
}: {
  actionId: string;
  submitLabel: string;
  fields: FieldProps[];
  otherChildren: ReactNode[];
  onAction?: A2uiActionHandler;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const missingRequired = fields.some((f) => f.required && !(values[f.name] ?? "").trim());
  const disabled = !onAction || !actionId || submitted;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || missingRequired) return;
        setSubmitted(true);
        const formData: Record<string, string> = {};
        for (const f of fields) {
          const v = (values[f.name] ?? "").trim();
          if (v) formData[f.name] = v;
        }
        onAction!({ actionId, label: submitLabel, formData });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      {otherChildren}
      {fields.map((f) => (
        <FieldInput
          key={f.name}
          label={f.required ? `${f.label} *` : f.label}
          placeholder={f.placeholder}
          multiline={f.multiline}
          value={values[f.name] ?? ""}
          onChange={submitted ? undefined : (v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
        />
      ))}
      <button
        type="submit"
        disabled={disabled || missingRequired}
        style={{
          alignSelf: "flex-start",
          height: 30,
          padding: "0 14px",
          borderRadius: radius.md,
          border: "none",
          background: color.dark,
          color: "#fff",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: disabled || missingRequired ? "default" : "pointer",
          opacity: disabled || missingRequired ? 0.5 : 1,
        }}
      >
        {submitted ? "Sent" : submitLabel}
      </button>
    </form>
  );
}

/** Coerce an untrusted prop to a printable string (missing/object → ""). */
function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function tone(v: unknown): A2uiTone {
  return v === "info" || v === "success" || v === "warning" || v === "danger" ? v : "neutral";
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: `1px solid ${color.border}`,
  background: color.surfaceMuted,
  fontWeight: 600,
  color: color.mutedDark,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "6px 10px",
  borderBottom: `1px solid ${color.borderLight}`,
  color: color.ink,
  verticalAlign: "top",
};

function FallbackNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginTop: 10, fontSize: 12, color: color.mutedLight, fontFamily: font.sans }}>{children}</div>
  );
}
