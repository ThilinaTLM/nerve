import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived once from this module's location (`scripts/workspace/`). */
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Read and parse a JSON file (path relative to `root`, which defaults to the repository root). */
export function readJson<T = Record<string, unknown>>(
  path: string,
  root: string = repoRoot,
): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

/** A root or workspace manifest that declares its identity (release tooling asserts this). */
export type ReleaseManifest = PackageManifest & {
  name: string;
  version: string;
};

/** The `package.json` fields repository tooling reads. */
export interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: unknown;
  license?: unknown;
  type?: string;
  main?: string;
  bin?: Record<string, string>;
  repository?: { directory?: string };
  bundleDependencies?: string[];
  exports?: unknown;
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  [key: string]: unknown;
}
