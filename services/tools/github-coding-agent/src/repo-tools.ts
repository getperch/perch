import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { tool } from "@strands-agents/sdk";
import { z } from "zod";

const exec = promisify(execCb);

/** Caps how much of any one file/command's output rides in the model's context. */
const OUTPUT_CAP = 20_000;
/** No single shell command gets to run past this — the whole invocation still has the Lambda's
 * own timeout as the real ceiling, this just stops one hung command eating the entire budget. */
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Resolves a model-supplied relative path against the checkout root and refuses to leave it —
 * the model only ever gets to see/touch files inside its own clone. */
function resolveInRepo(checkoutDir: string, relativePath: string): string {
  const resolved = path.resolve(checkoutDir, relativePath);
  if (resolved !== checkoutDir && !resolved.startsWith(checkoutDir + path.sep)) {
    throw new Error(`path "${relativePath}" escapes the checkout root`);
  }
  return resolved;
}

/** Strips the token out of anything a shell command might echo back (a failed `git push` prints
 * the tokenised remote URL) before it reaches the model or an event payload. */
export function redact(text: string, token: string): string {
  const out = token ? text.split(token).join("***") : text;
  return out.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
}

/**
 * The file/shell tools handed to the inner coding agent (see handler.ts) — same shape as the old
 * Code Interpreter-backed `read_file`/`write_file`/`list_files`/`run` actions on the `github` tool,
 * just operating on this Lambda's own local `/tmp` instead of a remote sandbox session.
 */
export function makeRepoTools(checkoutDir: string, token: string) {
  const readFile = tool({
    name: "read_file",
    description: "Read a file's contents, relative to the repo checkout root.",
    inputSchema: z.object({ path: z.string() }),
    callback: async ({ path: p }) => {
      const content = await fs.readFile(resolveInRepo(checkoutDir, p), "utf8");
      return { ok: true, path: p, content: content.slice(0, OUTPUT_CAP) };
    },
  });

  const writeFile = tool({
    name: "write_file",
    description: "Write a file's full contents, relative to the repo checkout root. Overwrites if it already exists; creates parent directories as needed.",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    callback: async ({ path: p, content }) => {
      const abs = resolveInRepo(checkoutDir, p);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      return { ok: true, path: p, bytes: Buffer.byteLength(content, "utf8") };
    },
  });

  const listFiles = tool({
    name: "list_files",
    description: "List files and directories at a path relative to the repo checkout root — defaults to the root.",
    inputSchema: z.object({ directoryPath: z.string().optional() }),
    callback: async ({ directoryPath }) => {
      const abs = resolveInRepo(checkoutDir, directoryPath ?? ".");
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const listing = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n");
      return { ok: true, directoryPath: directoryPath ?? ".", listing: listing.slice(0, OUTPUT_CAP) };
    },
  });

  const runCommand = tool({
    name: "run_command",
    description:
      'Run a shell command in the repo checkout (e.g. "npm ci && npm test"). Do NOT run git commands here — ' +
      "commit/push happens automatically when you call submit_work.",
    inputSchema: z.object({ command: z.string() }),
    callback: async ({ command }) => {
      try {
        const { stdout, stderr } = await exec(command, { cwd: checkoutDir, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
        return { ok: true, exitCode: 0, stdout: redact(stdout, token).slice(0, OUTPUT_CAP), stderr: redact(stderr, token).slice(0, OUTPUT_CAP) };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
        return {
          ok: false,
          exitCode: e.code ?? 1,
          stdout: redact(e.stdout ?? "", token).slice(0, OUTPUT_CAP),
          stderr: redact(e.stderr ?? e.message, token).slice(0, OUTPUT_CAP),
        };
      }
    },
  });

  return { readFile, writeFile, listFiles, runCommand };
}
