import { readFileSync } from "node:fs";

/**
 * Host-side reader of the built-in extensions' doc topics. Extensions only declare
 * topic paths (`DocTopic.file`, relative to the extension's folder, e.g. `docs/workflows.md`);
 * the host reads them through this. Files are copied by `scripts/build/copy-extension-assets.ts`
 * into `dist/extension-docs/<id>/`; like the sandbox libraries, that folder resolves from `dist/`
 * and from the flat desktop bundle. Run from source (tsx), topics are read in place.
 */
const fromSource = import.meta.url.endsWith(".ts");

export function readBuiltinExtensionDoc(
  extensionId: string,
  file: string,
): string {
  const path = fromSource
    ? `./${extensionId}/${file}`
    : `./extension-docs/${extensionId}/${file}`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
