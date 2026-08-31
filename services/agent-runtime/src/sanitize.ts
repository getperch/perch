/**
 * Turns a thrown error into a short line safe to show a user in a channel and on the run page:
 * strips ARNs, 12-digit account ids, `file://` and absolute paths, and `at fn (file:line:col)`
 * stack frames, keeps the first meaningful sentence(s), and caps the length. Most real failures
 * here — model access denied, tool gateway 4xx/5xx, timeouts, malformed responses — carry a
 * useful message that survives this untouched; only infra plumbing detail gets scrubbed.
 */
export function sanitizeRunError(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : String(err ?? "Unexpected error");
  const cleaned = raw
    .replace(/arn:aws[a-z-]*:[^\s"'`)]+/gi, "<resource>")
    .replace(/\b\d{12}\b/g, "<id>")
    .replace(/\bfile:\/\/\S+/gi, "")
    .replace(/(?:\/[\w.@-]+){3,}/g, "<path>")
    .replace(/\n\s*at\s+.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentences = cleaned.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  const out = (firstSentences || cleaned).slice(0, 300).trim();
  return out || "The run stopped on an unexpected error.";
}
