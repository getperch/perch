import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadStoredSession, clearSession } from "./auth-token-store.js";

type AuthState = { status: "loading" | "signed-out" | "signed-in" };

let state: AuthState = { status: "loading" };
const listeners = new Set<() => void>();
function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Restores a previously signed-in session from the on-disk store, if any. */
async function restoreSession() {
  const saved = await loadStoredSession();
  setState({ status: saved ? "signed-in" : "signed-out" });
}
restoreSession();

/**
 * Starts the PKCE flow — Rust's `begin_sign_in` command (src-tauri/src/auth.rs) generates the
 * verifier/challenge, stores the verifier in memory on its side, and opens the system browser to
 * OpenAuth's hosted sign-in page itself.
 */
export async function beginSignIn() {
  await invoke("begin_sign_in");
}

/**
 * Finishes the flow once the `fizz://callback?code=...` URL comes back — normally via the
 * deep-link plugin (see main.tsx), but also callable with a manually pasted URL as a fallback
 * for environments where OS-level URL-scheme handling isn't reliable (e.g. `tauri dev` on Linux
 * without the app bundled/installed). Rust's `complete_sign_in` command does the token exchange
 * and writes the resulting session to the store; this just reflects that in React state.
 */
export async function completeSignIn(callbackUrl: string) {
  await invoke("complete_sign_in", { callbackUrl });
  setState({ status: "signed-in" });
}

export async function signOut() {
  await clearSession();
  setState({ status: "signed-out" });
}

export function useAuth() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
}
