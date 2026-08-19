import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Baseline hardening for server-side fetches of user-supplied URLs (currently just plugin
 * import — see routers/plugins.ts). Blocks the fetch from ever reaching a private, loopback,
 * link-local, or cloud-metadata address, including via a redirect chain, by resolving and
 * checking every hop's IP before connecting to it rather than trusting the hostname alone.
 */

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5_000;
export const MAX_RESPONSE_BYTES = 1_000_000;

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 0) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    return false;
  }
  return true; // couldn't classify — refuse rather than risk it
}

async function assertHostIsPublic(hostname: string) {
  const records = await lookup(hostname, { all: true });
  if (records.length === 0) throw new Error(`could not resolve host "${hostname}"`);
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error(`host "${hostname}" resolves to a disallowed address`);
  }
}

/** Fetches a URL that must be https and whose host must already be workspace-allowlisted by the caller. */
export async function safeFetch(startUrl: string): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; ; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error(`only https:// URLs are allowed, got "${parsed.protocol}"`);
    await assertHostIsPublic(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(parsed, { redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      url = new URL(res.headers.get("location")!, parsed).toString();
      continue;
    }
    return res;
  }
}

/** Reads a Response body, refusing anything over MAX_RESPONSE_BYTES. */
export async function readCapped(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) throw new Error(`response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  return new TextDecoder().decode(buf);
}
