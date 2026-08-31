/**
 * Feature flags — one typed catalog plus a pure resolver. No framework, no I/O: the
 * host (see `apps/desktop/src/lib/flags.ts`) gathers the inputs and calls `resolveFlags`
 * once at startup, then hands the result to `<FlagsProvider>` in `@perch/ui`.
 *
 * A flag's value resolves through, in order (later wins):
 *   1. build baseline   — `prod` / `dev` on the FlagDef
 *   2. platform gate     — `platforms`, if set, forces the flag off elsewhere
 *   3. local override    — dev builds only; a persisted per-flag force
 *
 * The platform gate is applied *before* the override on purpose: a dev on mobile can't
 * force a desktop-only feature into a state it was never built to run in.
 */

export type Platform = "desktop" | "mobile";
export type BuildMode = "dev" | "prod";

export type FeatureFlag = "canvases" | "routines";

interface FlagDef {
  /** One line — feeds docs and any future dev panel. */
  description: string;
  /** Value in a production build when nothing else overrides it. */
  prod: boolean;
  /** Value in a dev build. Defaults to `true` when omitted. */
  dev?: boolean;
  /** If set, the flag is forced off on any platform not listed, regardless of the above. */
  platforms?: Platform[];
}

export const FLAGS: Record<FeatureFlag, FlagDef> = {
  canvases: {
    description: "Shared collaborative documents. Stub 'Coming soon' screen only today.",
    prod: false,
  },
  routines: {
    description: "Routines list/detail plus the local Playwright routine recorder.",
    prod: false,
    // The recorder drives a local browser through the desktop sidecar — no mobile path yet.
    platforms: ["desktop"],
  },
};

export const ALL_FLAGS = Object.keys(FLAGS) as FeatureFlag[];

export interface FlagContext {
  mode: BuildMode;
  platform: Platform;
  /** Dev-only per-flag forces. Ignored entirely when `mode === "prod"`. */
  overrides?: Partial<Record<FeatureFlag, boolean>>;
}

export type ResolvedFlags = Record<FeatureFlag, boolean>;

export function resolveFlag(flag: FeatureFlag, ctx: FlagContext): boolean {
  const def = FLAGS[flag];
  if (def.platforms && !def.platforms.includes(ctx.platform)) return false;
  if (ctx.mode === "dev" && ctx.overrides && flag in ctx.overrides) {
    return ctx.overrides[flag]!;
  }
  return ctx.mode === "dev" ? def.dev ?? true : def.prod;
}

export function resolveFlags(ctx: FlagContext): ResolvedFlags {
  const out = {} as ResolvedFlags;
  for (const key of ALL_FLAGS) out[key] = resolveFlag(key, ctx);
  return out;
}
