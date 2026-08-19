import { load } from "@tauri-apps/plugin-store";
export type BackendConfig = { apiUrl: string };

const STORE_FILE = "backend-config.json";
const KEY = "backendConfig";

export async function loadStoredBackendConfig(): Promise<BackendConfig | null> {
  const store = await load(STORE_FILE, { autoSave: false });
  return (await store.get<BackendConfig>(KEY)) ?? null;
}

export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.set(KEY, config);
  await store.save();
}

export async function clearBackendConfig(): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.delete(KEY);
  await store.save();
}

export function normalizeApiUrl(rawApiUrl: string): string {
  const apiUrl = rawApiUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(apiUrl)) throw new Error("Enter a full URL, starting with https://");
  return apiUrl;
}
