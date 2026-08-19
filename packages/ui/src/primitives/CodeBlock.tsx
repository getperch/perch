/// <reference path="../react-syntax-highlighter.d.ts" />
import { useState, type CSSProperties } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash.js";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css.js";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json.js";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx.js";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup.js";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python.js";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx.js";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript.js";
import { CheckIcon, CopyIcon } from "../icons.js";
import { color, font, radius } from "../tokens.js";

SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("javascript", jsx);
SyntaxHighlighter.registerLanguage("js", jsx);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("xml", markup);
SyntaxHighlighter.registerLanguage("markup", markup);

/** Built from tokens.ts rather than a canned Prism theme, so highlighted code stays visually
 * consistent with the rest of the app instead of importing its own unrelated palette. */
const syntaxStyle: Record<string, CSSProperties> = {
  'pre[class*="language-"]': { background: "transparent", margin: 0, padding: 0 },
  'code[class*="language-"]': { background: "transparent", color: color.ink },
  comment: { color: color.mutedLight, fontStyle: "italic" },
  prolog: { color: color.mutedLight },
  doctype: { color: color.mutedLight },
  cdata: { color: color.mutedLight },
  punctuation: { color: color.mutedDark },
  property: { color: color.accentText },
  tag: { color: color.accentText },
  boolean: { color: color.accentText },
  number: { color: color.accentText },
  constant: { color: color.accentText },
  symbol: { color: color.accentText },
  selector: { color: color.live },
  "attr-name": { color: color.live },
  string: { color: color.live },
  char: { color: color.live },
  builtin: { color: color.live },
  operator: { color: color.mutedDark },
  entity: { color: color.mutedDark },
  url: { color: color.mutedDark },
  keyword: { color: color.accent, fontWeight: 600 },
  function: { color: color.ink, fontWeight: 600 },
  "class-name": { color: color.ink, fontWeight: 600 },
  regex: { color: color.live },
  important: { color: color.accent, fontWeight: 600 },
  variable: { color: color.ink },
};

const SUPPORTED_LANGS = new Set([
  "typescript", "ts", "tsx", "javascript", "js", "jsx", "json", "bash", "sh", "shell", "python", "py", "css", "html", "xml", "markup",
]);

export function CodeBlock({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const language = lang && SUPPORTED_LANGS.has(lang.toLowerCase()) ? lang.toLowerCase() : undefined;

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surfaceMuted, overflow: "hidden" }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 10px", borderBottom: `1px solid ${color.border}`, font: `500 11px ${font.mono}`, color: color.mutedDark }}>
          {title}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <button
          onClick={copy}
          className="ws-hoverable"
          title="Copy code"
          style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.sm, cursor: "pointer" }}
        >
          {copied ? <CheckIcon size={11} stroke={color.live} /> : <CopyIcon size={12} />}
        </button>
        {language ? (
          <SyntaxHighlighter
            language={language}
            style={syntaxStyle}
            customStyle={{ margin: 0, padding: "12px 14px", background: "transparent", fontSize: 12, lineHeight: 1.6 }}
            codeTagProps={{ style: { fontFamily: font.mono } }}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <pre style={{ margin: 0, padding: "12px 14px", font: `400 12px/1.6 ${font.mono}`, color: color.ink, whiteSpace: "pre-wrap", overflowX: "auto" }}>
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
