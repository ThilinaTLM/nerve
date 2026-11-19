// Ambient types for an extension's UI sources: Vite's client types (`import.meta.glob`,
// `import.meta.env`, `?url` and `?raw` imports, asset imports) and `.svelte` modules.
// Use it from `src/env.d.ts`: `/// <reference types="@nervekit/extension-sdk/env" />`.
/// <reference types="vite/client" />

declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  export default component;
}
