import { readFileSync } from "node:fs";

/**
 * `quick_script` doc topics (Markdown next to the extension or runtime code that owns them), copied by
 * `scripts/build/copy-tools-assets.ts` into `dist/quick-script-docs/<owner>/`. Like the sandbox libraries,
 * the folder resolves from `dist/` and from the flat desktop bundle; run from source (tsx), topics are read in place.
 */
const fromSource = import.meta.url.endsWith(".ts");

export function readQuickScriptDoc(owner: string, file: string): string {
  const path = !fromSource
    ? `./quick-script-docs/${owner}/${file}`
    : owner === "runtime"
      ? `./execution/quick-script/docs/${file}`
      : `./execution/quick-script/extensions/${owner}/docs/${file}`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
