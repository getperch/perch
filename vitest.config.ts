import { defineConfig } from "vitest/config";

/**
 * Single workspace-wide test runner. The repo previously had no test setup — tests live next to
 * the code they cover as `*.test.ts` / `*.test.tsx`. Run with `pnpm test`.
 *
 * `@perch/*` packages publish their TypeScript `src` directly (no build step — see each
 * package.json `main`), so Vite resolves the `./foo.js` specifiers in them to `foo.ts`
 * transparently, same as the desktop app's build already relies on.
 */
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    include: ["{packages,services}/*/src/**/*.test.{ts,tsx}"],
  },
});
