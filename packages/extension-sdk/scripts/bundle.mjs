// Emits `dist/*.js`: esbuild bundles the SDK's entries and inlines the extension manifest schema
// from `@nervekit/contracts` (a dev dependency; contracts is not published). Everything else
// stays an import, resolved from the SDK's own dependencies at runtime.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  new URL("../ui/components.ts", import.meta.url),
);
await build({
  entryPoints: { ui: "src/ui.ts", icons: "src/icons.ts" },
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
      // `src/ui/components.d.ts` types the implementation that lives outside the type-checked sources.
      name: "ui-components",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/ui\/components\.js$/ }, () => ({
          path: uiComponents,
        }));
        // Svelte sources of the SDK stay as files next to the bundle (copied below); the
        // extension's UI build compiles them.
        builder.onResolve({ filter: /^\.\/[\w-]+\.svelte$/ }, (args) => ({
          path: `./ui/${args.path.slice(2)}`,
          external: true,
        }));
      },
    },
  ],
});
await mkdir("dist/ui", { recursive: true });
await copyFile("src/ui/components.d.ts", "dist/ui/components.d.ts");
for (const name of ["floating-toolbar-menu.svelte", "item-menu.svelte"])
  await copyFile(`ui/${name}`, `dist/ui/${name}`);
