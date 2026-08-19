import { useSyncExternalStore } from "react";
import type { Toast } from "@perch/ui";

/** Same module-level-store + useSyncExternalStore shape as `auth.ts` — a global store so any
 * mutation's onError (or auth.ts's signed-out path) can push a toast without needing to be
 * inside the same component tree as the host that renders them. */
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
function setToasts(next: Toast[]) {
  toasts = next;
  listeners.forEach((l) => l());
}

export function pushToast(tone: Toast["tone"], message: string) {
  const id = crypto.randomUUID();
  setToasts([...toasts, { id, tone, message }]);
  setTimeout(() => dismissToast(id), 5000);
}

export function dismissToast(id: string) {
  setToasts(toasts.filter((t) => t.id !== id));
}

export function useToasts() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => toasts,
  );
}
