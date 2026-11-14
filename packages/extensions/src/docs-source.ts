import { readFileSync } from "node:fs";

/**
 * Doc topics of the built-in extensions (Markdown next to the code that owns them), copied by
 * `scripts/build/copy-extension-assets.ts` into `dist/extension-docs/<owner>/`. Like the sandbox libraries,
 * the folder resolves from `dist/` and from the flat desktop bundle; run from source (tsx), topics are read in place.
 */
const fromSource = import.meta.url.endsWith(".ts");

export function readExtensionDoc(owner: string, file: string): string {
  const path = fromSource
    ? `./${owner}/docs/${file}`
    : `./extension-docs/${owner}/${file}`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
