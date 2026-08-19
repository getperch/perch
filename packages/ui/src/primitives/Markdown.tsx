import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { color, font, radius } from "../tokens.js";
import { CodeBlock } from "./CodeBlock.js";

/** Thin wrappers matching the app's existing plain-text message styling (14px, 1.55 line-height,
 * color.ink) so a markdown-rendered agent message doesn't visually diverge from a plain one. */
const components: Components = {
  p: ({ children }) => <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.55, color: color.ink }}>{children}</p>,
  h1: ({ children }) => <h1 style={{ margin: "12px 0 6px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: color.ink }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: "12px 0 6px", fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: color.ink }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: "10px 0 4px", fontSize: 14, fontWeight: 600, color: color.ink }}>{children}</h3>,
  ul: ({ children }) => <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14, lineHeight: 1.55, color: color.ink }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 14, lineHeight: 1.55, color: color.ink }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote style={{ margin: "0 0 8px", padding: "2px 12px", borderLeft: `2px solid ${color.borderStrong}`, color: color.mutedDark, fontSize: 14, lineHeight: 1.55 }}>
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  hr: () => <hr style={{ border: "none", borderTop: `1px solid ${color.border}`, margin: "10px 0" }} />,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", marginBottom: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${color.borderStrong}`, fontWeight: 600, color: color.mutedDark, whiteSpace: "nowrap" }}>
      {children}
    </th>
  ),
  td: ({ children }) => <td style={{ padding: "6px 10px", borderBottom: `1px solid ${color.border}`, color: color.ink }}>{children}</td>,
  code(props) {
    const { children, className, node, ...rest } = props as {
      children?: React.ReactNode;
      className?: string;
      node?: { position?: { start: { line: number } } };
    };
    // ReactMarkdown gives inline code no `className`; fenced code blocks carry `language-xxx`.
    const isBlock = Boolean(className) || String(children).includes("\n");
    if (!isBlock) {
      return (
        <code
          {...rest}
          style={{ font: `400 12.5px ${font.mono}`, background: color.surfaceMuted, border: `1px solid ${color.border}`, borderRadius: radius.sm, padding: "1px 5px", color: color.ink }}
        >
          {children}
        </code>
      );
    }
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    return (
      <div style={{ marginBottom: 8 }}>
        <CodeBlock code={String(children).replace(/\n$/, "")} lang={lang} />
      </div>
    );
  },
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
