// Emits `dist/*.js`: esbuild bundles the SDK's entries and inlines the extension manifest schema
// from `@nervekit/contracts` (a dev dependency; contracts is not published). Everything else
// stays an import, resolved from the SDK's own dependencies at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/testing.ts", "src/build.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  legalComments: "none",
  logLevel: "warning",
  external: [
    "@nervekit/extension-api",
    "@nervekit/extension-api/*",
    "esbuild",
    "typescript",
    "vitest",
    "zod",
  ],
});
