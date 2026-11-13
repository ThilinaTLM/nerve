import { readFileSync } from "node:fs";

/**
 * Sandbox libraries copied by `scripts/build/copy-quick-script-assets.ts` into
 * `dist/sandbox-libraries/`. This module lives at the package src root so
 * `./sandbox-libraries/` resolves from `dist/` and from the flat desktop
 * bundle's `dist/`; run from source (tsx), it reads the same `dist/` copy.
 */
const directory = import.meta.url.endsWith(".ts")
  ? "../dist/sandbox-libraries/"
  : "./sandbox-libraries/";

export function readSandboxLibrarySource(file: string): string {
  return readFileSync(new URL(`${directory}${file}`, import.meta.url), "utf8");
}
