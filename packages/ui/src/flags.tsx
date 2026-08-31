import { createContext, useContext, type ReactNode } from "react";
import type { FeatureFlag, ResolvedFlags } from "@perch/core";

/**
 * The resolved flag set for this session (see `@perch/core`'s `resolveFlags`). The host
 * app computes it once at startup — platform detection and the persisted dev overrides
 * live there — and drops it in here so every screen reads the same values.
 */
const FlagsContext = createContext<ResolvedFlags | null>(null);

export function FlagsProvider({ value, children }: { value: ResolvedFlags; children: ReactNode }) {
  return <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>;
}

export function useFlags(): ResolvedFlags {
  const ctx = useContext(FlagsContext);
  if (!ctx) throw new Error("useFlags must be used within <FlagsProvider>");
  return ctx;
}

export function useFlag(name: FeatureFlag): boolean {
  return useFlags()[name];
}

/** Declarative gate: renders `children` when the flag is on, `fallback` (default nothing) when off. */
export function Flag({
  name,
  children,
  fallback = null,
}: {
  name: FeatureFlag;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <>{useFlag(name) ? children : fallback}</>;
}
