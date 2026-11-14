import { readFileSync } from "node:fs";

/**
 * Sandbox libraries copied by `scripts/build/copy-quick-script-assets.ts` into
 * `dist/quick-script/sandbox-libraries/`. This module lives at the quick-script src root so
 * `./sandbox-libraries/` resolves from `dist/quick-script/` and from the flat desktop
 * bundle's `dist/`; run from source (tsx), it reads the same `dist/` copy.
 */
const directory = import.meta.url.endsWith(".ts")
  ? "../../dist/quick-script/sandbox-libraries/"
  : "./sandbox-libraries/";

export function readSandboxLibrarySource(file: string): string {
  return readFileSync(new URL(`${directory}${file}`, import.meta.url), "utf8");
}
