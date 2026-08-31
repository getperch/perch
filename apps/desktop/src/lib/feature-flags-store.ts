import { load } from "@tauri-apps/plugin-store";
import type { FeatureFlag } from "@perch/core";

/**
 * Dev-only per-flag forces, persisted next to `backend-config.json` in the app's Tauri
 * store dir. Never consulted in a production build (see `resolveAppFlags`), so it can't
 * turn an unfinished feature on in a shipped app. There's no in-app editor yet — set it
 * by hand for QA, e.g. `{"overrides":{"routines":true}}`.
 */
export type FlagOverrides = Partial<Record<FeatureFlag, boolean>>;

const STORE_FILE = "feature-flags.json";
const KEY = "overrides";

export async function loadFlagOverrides(): Promise<FlagOverrides> {
  const store = await load(STORE_FILE, { autoSave: false });
  return (await store.get<FlagOverrides>(KEY)) ?? {};
}

export async function saveFlagOverrides(next: FlagOverrides): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.set(KEY, next);
  await store.save();
}
