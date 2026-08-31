import { useSyncExternalStore } from "react";

/**
 * A one-slot store for a `perch://plugins/import?url=…` deep link. `main.tsx`'s deep-link
 * listener stashes the target `plugin.json` URL here; `Workspace` (App.tsx) consumes it once it's
 * signed in and mounted, opening the "Add agent → Import from URL" flow prefilled. Module-level,
 * like the auth store, so it survives the signed-out → signed-in transition when the link arrives
 * before the user has a session.
 */
let pendingUrl: string | null = null;
const listeners = new Set<() => void>();

export function setPendingPluginImport(url: string) {
  pendingUrl = url;
  listeners.forEach((l) => l());
}

export function clearPendingPluginImport() {
  if (pendingUrl === null) return;
  pendingUrl = null;
  listeners.forEach((l) => l());
}

export function usePendingPluginImport(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => pendingUrl,
  );
}
