import { readFileSync } from "node:fs";

/**
 * Host-side reader of the built-in extensions' files. Extensions only declare paths
 * (`DocTopic.file`, e.g. `docs/workflows.md`; `icon`, e.g. `icon.svg`), relative to the
 * extension's folder; the host reads them through this. Files are copied by
 * `scripts/build/copy-extension-assets.ts` into `dist/extension-assets/<id>/`; like the
 * sandbox libraries, that folder resolves from `dist/` and from the flat desktop bundle.
 * Run from source (tsx), files are read in place.
 */
const fromSource = import.meta.url.endsWith(".ts");

export function readBuiltinExtensionAsset(
  extensionId: string,
  file: string,
): string {
  const path = fromSource
    ? `./${extensionId}/${file}`
    : `./extension-assets/${extensionId}/${file}`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/**
 * The sandbox bundle of a built-in extension (`bundle.js`, one classic script). It is
 * built, not copied, so run from source it is read from the package's `dist/`.
 */
export function readBuiltinExtensionBundle(extensionId: string): string {
  const path = fromSource
    ? `../dist/extension-assets/${extensionId}/bundle.js`
    : `./extension-assets/${extensionId}/bundle.js`;
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
