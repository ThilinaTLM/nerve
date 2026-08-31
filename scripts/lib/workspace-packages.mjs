/**
 * Canonical workspace inventory and version helpers for release tooling.
 *
 * These lists used to be duplicated in scripts/verify-release-tag.mjs,
 * scripts/pack-npm.mjs, and scripts/verify-npm-tarballs.mjs; keeping a single
 * source of truth here prevents the copies from drifting apart.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRustReleaseVersions } from "./release-version.mjs";
import { workspacePackageByDirectory } from "./workspace-architecture.mjs";

/** Absolute repository root for scripts executed from scripts/. */
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Workspace packages that must stay version-locked to the root release
 * version. ui-kit and website intentionally are not listed here; they are not
 * part of the tagged release surface.
 */
export const versionLockedPackages = [
  "contracts",
  "native",
  "protocol",
  "harness",
  "tools",
  "workbench-server",
  "workbench-app",
  "desktop-shell",
];

/** The npm-published @nervekit packages bundled into the desktop tarball. */
export const bundledPackages = [
  ["@nervekit/contracts", "contracts"],
  ["@nervekit/native", "native"],
  ["@nervekit/protocol", "protocol"],
  ["@nervekit/harness", "harness"],
  ["@nervekit/tools", "tools"],
  ["@nervekit/workbench-server", "workbench-server"],
];

for (const directory of versionLockedPackages) {
  if (!workspacePackageByDirectory.has(directory)) {
    throw new Error(`Unknown version-locked workspace package: ${directory}`);
  }
}
for (const [name, directory] of bundledPackages) {
  const definition = workspacePackageByDirectory.get(directory);
  if (definition?.name !== name) {
    throw new Error(
      `Bundled package inventory mismatch: ${name} at ${directory}`,
    );
  }
}

export async function readJson(relativePath, rootDirectory = repoRoot) {
  return JSON.parse(await readFile(join(rootDirectory, relativePath), "utf8"));
}

/**
 * Reads the root and every version-locked package manifest version.
 * Throws if any version-locked package does not declare a version.
 */
export async function workspaceVersions(rootDirectory = repoRoot) {
  const versions = new Map();
  versions.set(
    "package.json",
    (await readJson("package.json", rootDirectory)).version,
  );
  for (const directory of versionLockedPackages) {
    const relativePath = join("packages", directory, "package.json");
    const manifest = await readJson(relativePath, rootDirectory);
    if (typeof manifest.version !== "string" || !manifest.version) {
      throw new Error(`${relativePath} does not declare a version.`);
    }
    versions.set(relativePath, manifest.version);
  }
  const rustVersions = await readRustReleaseVersions(rootDirectory);
  versions.set("packages/native/native/Cargo.toml", rustVersions.manifest);
  versions.set("Cargo.lock (nerve-native)", rustVersions.lockfile);
  return versions;
}

/**
 * Throws if any version-locked package diverges from the root version.
 * Returns the root version when everything matches.
 */
export async function assertWorkspaceVersionsMatch(rootDirectory = repoRoot) {
  const versions = await workspaceVersions(rootDirectory);
  const rootVersion = versions.get("package.json");
  const mismatches = [...versions.entries()].filter(
    ([, version]) => version !== rootVersion,
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Workspace package versions must match root version ${rootVersion}:\n${mismatches
        .map(([path, version]) => `  ${path}: ${version}`)
        .join("\n")}`,
    );
  }
  return rootVersion;
}
