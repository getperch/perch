import { load } from "@tauri-apps/plugin-store";

export type StoredSession = { access: string; refresh: string };

const STORE_FILE = "auth.json";
const KEY = "session";

export async function loadStoredSession(): Promise<StoredSession | null> {
  const store = await load(STORE_FILE, { autoSave: false });
  return (await store.get<StoredSession>(KEY)) ?? null;
}

export async function saveSession(session: StoredSession): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.set(KEY, session);
  await store.save();
}

export async function clearSession(): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.delete(KEY);
  await store.save();
}
