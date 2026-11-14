import { readFileSync } from "node:fs";

/**
 * `quick_script` runtime doc topics (Markdown next to the runtime code), copied by
 * `scripts/build/copy-quick-script-assets.ts` into `dist/quick-script/quick-script-docs/runtime/`. Like the sandbox libraries,
 * the folder resolves from `dist/quick-script/` and from the flat desktop bundle; run from source (tsx), topics are read in place.
 * Extensions read their own topics (`@nervekit/extensions`).
 */
const fromSource = import.meta.url.endsWith(".ts");

export function readRuntimeDoc(file: string): string {
  const path = fromSource
    ? `./runtime/docs/${file}`
    : `./quick-script-docs/runtime/${file}`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
