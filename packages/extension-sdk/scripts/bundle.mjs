// Emits `dist/*.js`: esbuild bundles the SDK's entries and inlines the extension manifest schema
// from `@nervekit/contracts` (a dev dependency; contracts is not published). Everything else
// stays an import, resolved from the SDK's own dependencies at runtime.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/testing.ts", "src/cli.ts"],
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
    "@sveltejs/vite-plugin-svelte",
    "@tailwindcss/vite",
    "esbuild",
    "svelte",
    "svelte/*",
    "typescript",
    "vite",
    "vitest",
    "zod",
  ],
});

// The frame side: the bridge client, bundled with the contracts schemas it validates with. It
// runs in the extension's browser frame, where the extension's UI build (Vite) resolves what
// stays external (Svelte, zod, the UI kit's sources).
const uiComponents = fileURLToPath(
  new URL("../src/components/components.impl.ts", import.meta.url),
);
await build({
  entryPoints: { ui: "src/ui.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
  external: [
    "svelte",
    "svelte/*",
    "zod",
    "@lucide/svelte",
    "@nervekit/ui-kit",
    "@nervekit/ui-kit/*",
  ],
  plugins: [
    {
      // `components.impl.ts` re-exports Svelte sources, which tsc does not check; its declarations are generated from them.
      name: "ui-components",
      setup(builder) {
        builder.onResolve(
          { filter: /^\.\/components\/components\.js$/ },
          () => ({
            path: uiComponents,
          }),
        );
        // Svelte sources of the SDK stay as files next to the bundle (copied below); the
        // extension's UI build compiles them.
        builder.onResolve({ filter: /^\.\/[\w-]+\.svelte$/ }, (args) => ({
          path: `./components/${args.path.slice(2)}`,
          external: true,
        }));
      },
    },
  ],
});
// `dist/components/*.d.ts` (the generated declarations of the components) come from
// `scripts/components-dts.ts`, which runs before `tsc` in `pnpm build`.
await mkdir("dist/components", { recursive: true });
for (const name of [
  "floating-toolbar-menu.svelte",
  "item-menu.svelte",
  "select-field.svelte",
])
  await copyFile(`src/components/${name}`, `dist/components/${name}`);
