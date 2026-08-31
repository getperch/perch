// Copy the `pkg` output (dist/perch-sidecar[.exe]) to
// ../src-tauri/binaries/perch-sidecar-<rust-target-triple>[.exe] — the name Tauri's `externalBin`
// resolver expects for the current host.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const outDir = join(here, "..", "..", "src-tauri", "binaries");

function hostTriple() {
  try {
    const t = execSync("rustc --print host-tuple", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (t) return t;
  } catch {
    /* rustc < 1.84 — parse verbose output */
  }
  const line = execSync("rustc -vV").toString().split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("couldn't determine the Rust host target triple (is rustc installed?)");
  return line.slice("host:".length).trim();
}

const ext = process.platform === "win32" ? ".exe" : "";
const src = join(distDir, `perch-sidecar${ext}`);
if (!existsSync(src)) throw new Error(`pkg output not found at ${src}`);

const triple = hostTriple();
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, `perch-sidecar-${triple}${ext}`);
copyFileSync(src, dest);
console.log(`sidecar -> ${dest}`);
