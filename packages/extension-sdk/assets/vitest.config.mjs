// The Vitest setup `nerve-ext test` uses unless the project has its own vitest or vite config:
// a DOM, the Svelte compiler (UI tests import components and `@nervekit/extension-sdk/ui`) and
// the browser build of Svelte.
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const sdkPackage = fileURLToPath(new URL("../package.json", import.meta.url));

export default defineConfig({
  logLevel: "error",
  plugins: [
    {
      // One copy of Svelte for components, the SDK and `mount`, whatever the project's layout
      // (like `nerve-ext build`): resolve it from the SDK.
      name: "nerve-sdk-svelte",
      enforce: "pre",
      resolveId(source, _importer, options) {
        if (/^svelte(\/|$)/.test(source))
          return this.resolve(source, sdkPackage, {
            ...options,
            skipSelf: true,
          });
        return undefined;
      },
    },
    svelte({ configFile: false }),
  ],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    server: { deps: { inline: [/@nervekit\//] } },
  },
});
