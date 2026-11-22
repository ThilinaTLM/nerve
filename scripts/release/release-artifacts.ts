#!/usr/bin/env node
// The ten npm tarballs of a release: what Release: Cut attaches to the draft
// GitHub release, what Release: Publish uploads to npm and what Release:
// Promote moves between dist-tags. Runs under plain Node (no pnpm install).
//
//   node scripts/release/release-artifacts.ts checksums <dir> <version>
//   node scripts/release/release-artifacts.ts verify <dir> <version>
//   node scripts/release/release-artifacts.ts list <version>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expectedNativePlatformPackages,
  nativeTarballFilename,
} from "./native-prebuilds.ts";
import { CliError, defineCli } from "../cli/main.ts";

export const CHECKSUMS_FILE = "SHA256SUMS";

/** Extension packages in publish order: the SDK pins the other two at the exact version. */
const extensionPackages = [
  "@nervekit/extension-api",
  "@nervekit/ui-kit",
  "@nervekit/extension-sdk",
];

export interface ReleasePackage {
  name: string;
  tarball: string;
}

/** `npm pack`/`pnpm pack` filename: scope without `@`, `/` replaced by `-`. */
export function packTarballFilename(name: string, version: string) {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/**
 * Every release package in publish order: the platform packages, then
 * `@nervekit/desktop` (pins them as optionalDependencies), then the extension
 * packages.
 */
export async function releasePackages(
  version: string,
  rootDirectory?: string,
): Promise<ReleasePackage[]> {
  const platformPackages = await expectedNativePlatformPackages(rootDirectory);
  return [
    ...platformPackages.map((platformPackage) => ({
      name: platformPackage.name,
      tarball: nativeTarballFilename(platformPackage, version),
    })),
    ...["@nervekit/desktop", ...extensionPackages].map((name) => ({
      name,
      tarball: packTarballFilename(name, version),
    })),
  ];
}

function sha256(contents: Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

/** `sha256sum` format, sorted by filename. */
export function formatChecksums(sums: Map<string, string>) {
  return [...sums]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, hash]) => `${hash}  ${file}\n`)
    .join("");
}

export function parseChecksums(source: string) {
  const sums = new Map<string, string>();
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line);
    if (!match || sums.has(match[2]!))
      throw new Error(`Malformed ${CHECKSUMS_FILE} line: ${line}`);
    sums.set(match[2]!, match[1]!);
  }
  return sums;
}

/** Fails unless `actual` holds exactly the expected tarballs (plus SHA256SUMS when required). */
export function assertInventory(
  actual: string[],
  expected: string[],
  { withChecksums }: { withChecksums: boolean },
) {
  const want = [...expected, ...(withChecksums ? [CHECKSUMS_FILE] : [])].sort();
  const have = [...actual].sort();
  const missing = want.filter((file) => !have.includes(file));
  const extra = have.filter((file) => !want.includes(file));
  if (missing.length || extra.length)
    throw new Error(
      `Release artifacts do not match.${missing.length ? `\nMissing: ${missing.join(", ")}` : ""}${extra.length ? `\nUnexpected: ${extra.join(", ")}` : ""}`,
    );
}

function tarballManifest(path: string) {
  const result = spawnSync("tar", ["-xOzf", path, "package/package.json"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Could not read package.json from ${path}: ${result.stderr}`,
    );
  return JSON.parse(result.stdout) as { name?: string; version?: string };
}

/** Write SHA256SUMS for the ten tarballs; fails on a missing or unexpected file. */
export async function writeChecksums(directory: string, version: string) {
  const packages = await releasePackages(version);
  const files = (await readdir(directory)).filter((f) => f !== CHECKSUMS_FILE);
  assertInventory(
    files,
    packages.map((entry) => entry.tarball),
    { withChecksums: false },
  );
  const sums = new Map<string, string>();
  for (const file of files)
    sums.set(file, sha256(await readFile(join(directory, file))));
  await writeFile(join(directory, CHECKSUMS_FILE), formatChecksums(sums));
}

/**
 * Check a downloaded release: exactly the ten tarballs and SHA256SUMS, every
 * checksum matches, and every tarball holds the expected package and version.
 */
export async function verifyReleaseArtifacts(
  directory: string,
  version: string,
) {
  const packages = await releasePackages(version);
  const tarballs = packages.map((entry) => entry.tarball);
  assertInventory(await readdir(directory), tarballs, { withChecksums: true });
  const sums = parseChecksums(
    await readFile(join(directory, CHECKSUMS_FILE), "utf8"),
  );
  assertInventory([...sums.keys()], tarballs, { withChecksums: false });
  for (const { name, tarball } of packages) {
    const path = join(directory, tarball);
    if (sha256(await readFile(path)) !== sums.get(tarball))
      throw new Error(`${tarball} does not match ${CHECKSUMS_FILE}.`);
    const manifest = tarballManifest(path);
    if (manifest.name !== name || manifest.version !== version)
      throw new Error(
        `${tarball}: expected ${name}@${version}, found ${manifest.name}@${manifest.version}.`,
      );
  }
  return packages;
}

const usage =
  "Usage: release-artifacts.ts checksums <dir> <version> | verify <dir> <version> | list <version>";

await defineCli(import.meta.url, async ([command, ...args]) => {
  if (command === "checksums" && args.length === 2) {
    await writeChecksums(args[0]!, args[1]!);
    console.log(`Wrote ${CHECKSUMS_FILE} for ${args[1]} in ${args[0]}.`);
  } else if (command === "verify" && args.length === 2) {
    const packages = await verifyReleaseArtifacts(args[0]!, args[1]!);
    console.log(
      `Verified ${packages.length} release tarballs for ${args[1]} against ${CHECKSUMS_FILE}.`,
    );
  } else if (command === "list" && args.length === 1) {
    for (const { name, tarball } of await releasePackages(args[0]!))
      console.log(`${name} ${tarball}`);
  } else throw new CliError(usage);
});
