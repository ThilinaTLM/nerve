import eslint from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.svelte-kit/**",
      "**/.astro/**",
      "**/.vite/**",
      "packages/desktop-shell/build/**",
      "packages/desktop-shell/release/**",
      "release/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    // Browser environment for app and component UI source trees.
    files: [
      "packages/workbench-app/src/**",
      "packages/ui-kit/src/**",
      "packages/website/src/**",
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Node environment for servers, tooling, scripts, and configs. The UI
    // source trees are excluded so accidental process/window cross-use is
    // flagged instead of silently merged.
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: [
      "packages/workbench-app/src/**",
      "packages/ui-kit/src/**",
      "packages/website/src/**",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "max-lines": [
        "error",
        {
          max: 800,
          skipBlankLines: false,
          skipComments: false,
        },
      ],
    },
  },
);
