// The Vitest setup `nerve-ext test` uses unless the project has its own vitest or vite config:
// a DOM, the Svelte compiler (UI tests import components and `@nervekit/extension-sdk/ui`) and
// the browser build of Svelte.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  logLevel: "error",
  plugins: [svelte({ configFile: false })],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    server: { deps: { inline: [/@nervekit\//] } },
  },
});
