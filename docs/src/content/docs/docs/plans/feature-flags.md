---
title: "Plan: Feature flags"
description: "Platform gating and in-development feature flags for perch."
---

> **Status: implemented 2026-09-04.** Sections 1–4 and 6 landed as written. Section 5
> (unit tests) was skipped — the repo has no test runner (`vitest`/`jest`) wired up;
> add `flags.test.ts` when one exists. `@tauri-apps/plugin-os` resolves to `2.3.2`.
> TS typecheck (desktop, core, ui) and `cargo check` both pass.

## Goal

One typed flag system that resolves a flag's value from four layered inputs (later
layer wins):

1. **Build mode** — `dev` vs `prod` (`import.meta.env.DEV`). The v1 prod baseline is
   mostly "off".
2. **Platform** — `desktop` vs `mobile`, detected at runtime via
   `@tauri-apps/plugin-os` (one build serves both).
3. **Local override** — dev-only per-flag toggles persisted in a Tauri store. No
   in-app panel in this phase; edited via the store file / devtools.
4. **Remote** *(future, out of scope)* — a `featureFlags` field on `GET /workspace`
   for staged per-workspace rollout.

For v1: **Canvases** and **Routines + the routine recorder** ship behind flags that
default off in production, on in dev.

## How it maps onto today's code

- **One Tauri v2 codebase**, `targets: "all"` — desktop and mobile ship from the same
  `apps/desktop` build, so platform must be a *runtime* input, not a build constant.
- **No flag infrastructure today** — no `import.meta.env` usage, nothing in
  `@perch/core` or `@perch/ui`.
- `@tauri-apps/plugin-store` is already wired (`apps/desktop/src/lib/backend-config-store.ts`)
  — a natural home for persisted local overrides.
- Nav + routing is a flat `navItems` array + an `if (screen.name === …)` chain in
  `apps/desktop/src/App.tsx` — trivial to gate. "Canvases" is already a stubbed
  "Coming soon" screen.
- `workspace` schema in `packages/core/src/workspace.ts` is where server-driven flags
  would later ride (a `featureFlags` field) — not needed for v1.

## Resolution chain

A flag's value is computed once at startup:

```
prod baseline  ->  platform gate  ->  dev-only local override
```

- Platform gate is applied **before** the override so a dev on mobile can't force a
  desktop-only flag into a broken state. (If we'd rather devs override even that,
  swap the order in `resolveFlag`.)
- `overrides` is hard-ignored in prod — the persisted store can never turn a feature
  on in a shipped build.

---

## 1. `packages/core/src/flags.ts` (new)

Framework-agnostic: catalog, types, pure resolver. Exported from
`packages/core/src/index.ts` (`export * from "./flags.js";`).

```ts
export type Platform = "desktop" | "mobile";
export type BuildMode = "dev" | "prod";

export type FeatureFlag = "canvases" | "routines";

interface FlagDef {
  /** Shown in any future dev panel / docs. */
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
    description: "Shared collaborative documents. Stub screen only today.",
    prod: false,
  },
  routines: {
    description: "Routines list/detail + local Playwright recorder.",
    prod: false,
    // recorder drives a local browser via the sidecar — desktop-only for now
    platforms: ["desktop"],
  },
};

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
  return ctx.mode === "dev" ? (def.dev ?? true) : def.prod;
}

export function resolveFlags(ctx: FlagContext): ResolvedFlags {
  const out = {} as ResolvedFlags;
  for (const key of Object.keys(FLAGS) as FeatureFlag[]) out[key] = resolveFlag(key, ctx);
  return out;
}

export const ALL_FLAGS = Object.keys(FLAGS) as FeatureFlag[];
```

---

## 2. `@perch/ui` — context + hooks + gate

**New `packages/ui/src/flags.tsx`:**

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { FeatureFlag, ResolvedFlags } from "@perch/core";

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
```

Add to `packages/ui/src/index.ts`: `export * from "./flags.js";`

`@perch/core` is already a dependency of `@perch/ui` — no new package wiring.

---

## 3. `apps/desktop` — platform detection + store + provider

### 3a. Tauri OS plugin

- `apps/desktop/src-tauri/Cargo.toml`: add `tauri-plugin-os = "2"`
- `apps/desktop/src-tauri/src/lib.rs` (next to the other `.plugin(...)` calls): add
  `.plugin(tauri_plugin_os::init())`
- `apps/desktop/src-tauri/capabilities/default.json`: add `"os:default"` to `permissions`
- `apps/desktop/package.json`: add `"@tauri-apps/plugin-os": "^2.0.0"`

`platform()` from the plugin returns `"macos" | "windows" | "linux" | "ios" | "android"`.
Map `ios`/`android` -> `"mobile"`, else `"desktop"`.

> Fallback: if `platform()` throws (e.g. running the Vite dev server in a plain
> browser tab), default to `"desktop"`.

### 3b. `apps/desktop/src/lib/feature-flags-store.ts` (new)

Mirror `backend-config-store.ts`:

```ts
import { load } from "@tauri-apps/plugin-store";
import type { FeatureFlag } from "@perch/core";

const STORE_FILE = "feature-flags.json";
const KEY = "overrides";
export type FlagOverrides = Partial<Record<FeatureFlag, boolean>>;

export async function loadFlagOverrides(): Promise<FlagOverrides> {
  const store = await load(STORE_FILE, { autoSave: false });
  return (await store.get<FlagOverrides>(KEY)) ?? {};
}

export async function saveFlagOverrides(next: FlagOverrides): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: false });
  await store.set(KEY, next);
  await store.save();
}
```

### 3c. `apps/desktop/src/lib/flags.ts` (new) — resolve at startup

```ts
import { platform } from "@tauri-apps/plugin-os";
import { resolveFlags, type Platform, type ResolvedFlags } from "@perch/core";
import { loadFlagOverrides } from "./feature-flags-store.js";

function toPlatform(): Platform {
  try {
    const p = platform();
    return p === "ios" || p === "android" ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

export async function resolveAppFlags(): Promise<ResolvedFlags> {
  const mode = import.meta.env.DEV ? "dev" : "prod";
  const overrides = mode === "dev" ? await loadFlagOverrides() : undefined;
  return resolveFlags({ mode, platform: toPlatform(), overrides });
}
```

### 3d. Wire into `apps/desktop/src/main.tsx`

In `Providers`, resolve flags once alongside the existing `ready` gate, then wrap
`<App/>`:

```tsx
const [flags, setFlags] = useState<ResolvedFlags | null>(null);
useEffect(() => { resolveAppFlags().then(setFlags); }, []);
if (!ready || !flags) return null;

return (
  <QueryClientProvider client={queryClient}>
    <FlagsProvider value={flags}>
      <App />
    </FlagsProvider>
  </QueryClientProvider>
);
```

---

## 4. Gate the features in `apps/desktop/src/App.tsx`

### Nav items (around `App.tsx:670`)

```tsx
const flags = useFlags();
const navItems: NavItem[] = [
  { key: "home", label: "Home", glyph: <HomeIcon size={15} /> },
  { key: "mentions", label: "Notifications", glyph: <BellIcon size={15} />, count: unreadMentions || undefined, accentCount: true },
  { key: "tasks", label: "Tasks", glyph: <CheckSquareIcon size={15} />, count: tasks.data?.filter((t: Task) => t.status !== "done").length },
  { key: "knowledge", label: "Knowledge", glyph: <DocumentIcon size={15} stroke="currentColor" /> },
  ...(flags.routines ? [{ key: "routines", label: "Routines", glyph: <RepeatIcon size={15} /> } as NavItem] : []),
  ...(flags.canvases ? [{ key: "canvases", label: "Canvases", glyph: <GridIcon size={15} /> } as NavItem] : []),
  { key: "settings", label: "Settings", glyph: <SettingsIcon size={15} /> },
];
```

### Screen routes

Guard each gated branch so a stale `screen` state (or a deep link) can't render a
hidden feature:

- `if (screen.name === "canvases" && flags.canvases) { … }` — when the flag is off,
  redirect: `useEffect(() => { if (!flags.canvases && screen.name === "canvases") setScreen({ name: "home" }); }, [flags.canvases, screen.name])`.
- Same for `screen.name === "routines" | "routine" | "routine-record"` -> gate on
  `flags.routines`.

### Data queries

- `procedures` query (`App.tsx:144`) — add `enabled: flags.routines` so a
  flagged-off build makes no `/procedures` calls.
- The `procedure:local` listener effect (`App.tsx:293`) is already gated on
  `screen.name === "routine-record"`, which becomes unreachable — no change needed,
  the early `return` stays as defence.
- Canvases has no queries.

---

## 5. Tests

`packages/core/src/flags.test.ts` (match whatever runner core uses — check for an
existing `*.test.ts`):

- prod build: `canvases` / `routines` resolve `false`.
- dev build: both `true`.
- `routines` on `platform: "mobile"` -> `false` even in dev, even with
  `overrides: { routines: true }`.
- `overrides: { canvases: true }` in dev -> `true`; same override in a prod ctx ->
  still `false`.
- `resolveFlags` returns a key for every entry in `FLAGS`.

---

## 6. Rollout / usage notes

- **Turning a feature on for v1.x**: flip `prod: true` in `FLAGS` and ship. No
  consumer changes.
- **QA on a dev build**: edit `feature-flags.json` in the app's Tauri store dir
  (`~/.local/share/dev.perch.app/` on Linux,
  `~/Library/Application Support/dev.perch.app/` on macOS) ->
  `{"overrides":{"routines":true}}`, restart.
- **New flag**: add one entry to `FLAGS` + the `FeatureFlag` union; `ResolvedFlags`
  and the resolver pick it up automatically.
- **Mobile build**: `routines` is `platforms: ["desktop"]`, so it's inert on mobile
  without any per-call `if`. Add more mobile-excluded features the same way.

---

## Files touched

| File | Change |
|---|---|
| `packages/core/src/flags.ts` | **new** — catalog + resolver |
| `packages/core/src/index.ts` | export flags |
| `packages/core/src/flags.test.ts` | **new** — resolver tests |
| `packages/ui/src/flags.tsx` | **new** — `FlagsProvider`, `useFlag`, `useFlags`, `<Flag>` |
| `packages/ui/src/index.ts` | export flags |
| `apps/desktop/src-tauri/Cargo.toml` | `tauri-plugin-os` |
| `apps/desktop/src-tauri/src/lib.rs` | register plugin |
| `apps/desktop/src-tauri/capabilities/default.json` | `os:default` permission |
| `apps/desktop/package.json` | `@tauri-apps/plugin-os` |
| `apps/desktop/src/lib/feature-flags-store.ts` | **new** — persisted overrides |
| `apps/desktop/src/lib/flags.ts` | **new** — startup resolution |
| `apps/desktop/src/main.tsx` | resolve flags, wrap in `FlagsProvider` |
| `apps/desktop/src/App.tsx` | gate nav items, screen routes, `procedures` query |

**Not in this phase:** in-app Developer settings panel (`SettingsScreen` has a spare
`"advanced"` section it could slot into later); remote `featureFlags` on the
workspace schema.
