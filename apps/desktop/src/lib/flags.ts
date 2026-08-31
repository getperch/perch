import { platform } from "@tauri-apps/plugin-os";
import { resolveFlags, type Platform, type ResolvedFlags } from "@perch/core";
import { loadFlagOverrides } from "./feature-flags-store.js";

/** `ios`/`android` → mobile, everything else → desktop. Falls back to desktop if the OS
 * plugin isn't reachable (e.g. the Vite dev server opened in a plain browser tab). */
function currentPlatform(): Platform {
  try {
    const p = platform();
    return p === "ios" || p === "android" ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

/** Resolve the flag set once, at startup, before the app tree mounts. */
export async function resolveAppFlags(): Promise<ResolvedFlags> {
  const mode = import.meta.env.DEV ? "dev" : "prod";
  const overrides = mode === "dev" ? await loadFlagOverrides() : undefined;
  return resolveFlags({ mode, platform: currentPlatform(), overrides });
}
