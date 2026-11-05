import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// Opt-in component layer (`pnpm test:components`). Pure logic stays on `tsx --test`;
// only `*.svelte.test.ts` files run here. Layout-dependent behavior belongs in the browser suite.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    include: ["src/**/*.svelte.test.ts"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // bits-ui teardown reads deriveds of closing dialogs; the warning is noise in jsdom.
    onConsoleLog: (log) => (log.includes("derived_inert") ? false : undefined),
  },
});
