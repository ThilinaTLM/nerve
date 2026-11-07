#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedNativePlatformPackages,
  nativeTarballFilename,
  type NativePlatformPackage,
} from "./native-prebuilds.ts";
import { bundleOutputFiles } from "./bundle-desktop.ts";
import {
  checkBundleImports,
  smokeBundledDaemon,
  smokeWorkerEntrypoints,
} from "./bundle-smoke.ts";
import { externalRuntimeDependencies } from "./npm-manifests.ts";
import { readJson } from "./workspace-packages.ts";
import { repoRoot, type PackageManifest } from "../workspace/repo.ts";

const publicPackage = ["@nervekit/desktop", "desktop"];

export async function verifyNpmTarballs(
  packDirectory = join(repoRoot, "release", "npm"),
) {
  const rootVersion = (await readJson("package.json")).version;
  const expectedFilename = `nervekit-desktop-${rootVersion}.tgz`;
  const tarball = join(packDirectory, expectedFilename);
  const manifest = extractJson(tarball, "package/package.json");
  if (manifest.name !== publicPackage[0] || manifest.version !== rootVersion)
    throw new Error(
      `${expectedFilename}: expected ${publicPackage[0]}@${rootVersion}, found ${manifest.name}@${manifest.version}.`,
    );
  if (manifest.private === true)
    throw new Error(
      `${expectedFilename}: public manifest must not be private.`,
    );
  if (JSON.stringify(manifest).includes("workspace:"))
    throw new Error(
      `${expectedFilename}: public manifest contains a workspace dependency.`,
    );

  const entries = tarEntries(tarball);
  const platformPackages = await expectedNativePlatformPackages();
  verifyPublicManifest(
    manifest,
    rootVersion,
    expectedFilename,
    platformPackages.map((platformPackage) => platformPackage.name),
  );
  verifyContents(entries, expectedFilename);
  verifyDesktopBin(tarball, expectedFilename);

  const platformTarballs = new Map<string, string>();
  for (const platformPackage of platformPackages) {
    const filename = nativeTarballFilename(platformPackage, rootVersion);
    const platformTarball = join(packDirectory, filename);
    verifyNativePlatformTarball(
      extractJson(platformTarball, "package/package.json"),
      tarEntries(platformTarball),
      platformPackage,
      rootVersion,
      filename,
    );
    platformTarballs.set(platformPackage.name, platformTarball);
  }
  await isolatedInstallSmoke(tarball, rootVersion, platformTarballs);
  console.log(
    `Verified ${publicPackage[0]}@${rootVersion}, ${platformPackages.length} native platform tarballs and isolated runtime resolution.`,
  );
}

/** Checks one `@nervekit/native-<triple>` tarball: manifest metadata and exact contents. */
export function verifyNativePlatformTarball(
  manifest: PackageManifest,
  entries: string[],
  platformPackage: NativePlatformPackage,
  version: string,
  filename: string,
) {
  if (manifest.name !== platformPackage.name || manifest.version !== version)
    throw new Error(
      `${filename}: expected ${platformPackage.name}@${version}, found ${manifest.name}@${manifest.version}.`,
    );
  if (manifest.private === true)
    throw new Error(`${filename}: manifest must not be private.`);
  if (JSON.stringify(manifest).includes("workspace:"))
    throw new Error(`${filename}: manifest contains a workspace dependency.`);
  if (manifest.main !== platformPackage.filename)
    throw new Error(`${filename}: main must be ${platformPackage.filename}.`);
  const expectedFields: [string, unknown, unknown][] = [
    ["os", manifest.os, [platformPackage.os]],
    ["cpu", manifest.cpu, [platformPackage.cpu]],
    ["libc", manifest.libc, platformPackage.libc],
  ];
  for (const [field, actual, expected] of expectedFields)
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `${filename}: expected ${field} ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
      );
  const publishConfig = manifest.publishConfig as
    | { access?: string }
    | undefined;
  if (publishConfig?.access !== "public")
    throw new Error(`${filename}: publishConfig.access must be public.`);
  const repository = manifest.repository as { url?: string } | undefined;
  if (!repository?.url)
    throw new Error(`${filename}: repository.url is required for provenance.`);
  if (manifest.dependencies || manifest.optionalDependencies)
    throw new Error(`${filename}: platform package must have no dependencies.`);

  const expected = [
    "package/package.json",
    "package/LICENSE",
    "package/NOTICE",
    `package/${platformPackage.filename}`,
  ].sort();
  const actual = entries.filter((entry) => entry !== "package").sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${filename}: expected exactly ${expected.join(", ")}, found ${actual.join(", ")}.`,
    );
}

export function verifyPublicManifest(
  manifest: PackageManifest,
  version: string,
  filename: string,
  nativePackageNames: string[] = [],
) {
  if (manifest.main !== "dist/main.js")
    throw new Error(`${filename}: unexpected main entry ${manifest.main}.`);
  if (manifest.bin?.["nerve-desktop"] !== "./dist/bin.js")
    throw new Error(`${filename}: missing nerve-desktop bin entry.`);
  if (manifest.engines?.node !== ">=24.0.0")
    throw new Error(`${filename}: unexpected Node engine.`);
  if (manifest.repository?.directory !== "packages/desktop-shell")
    throw new Error(`${filename}: unexpected repository directory.`);

  if (manifest.bundleDependencies !== undefined)
    throw new Error(`${filename}: bundleDependencies must not be set.`);
  const dependencyNames = Object.keys(manifest.dependencies ?? {}).sort();
  const expectedDependencies = [...externalRuntimeDependencies].sort();
  if (JSON.stringify(dependencyNames) !== JSON.stringify(expectedDependencies))
    throw new Error(
      `${filename}: dependencies must be exactly the external packages ${expectedDependencies.join(", ")}, found ${dependencyNames.join(", ")}.`,
    );
  const expectedNative = Object.fromEntries(
    [...nativePackageNames].sort().map((name) => [name, version]),
  );
  if (
    JSON.stringify(manifest.optionalDependencies ?? {}) !==
    JSON.stringify(expectedNative)
  )
    throw new Error(
      `${filename}: optionalDependencies must pin exactly ${JSON.stringify(expectedNative)}.`,
    );
  for (const name of nativePackageNames)
    if (manifest.dependencies?.[name] !== undefined)
      throw new Error(`${filename}: ${name} must be optional, not required.`);
}

/** Files npm adds or the package ships at the root, besides dist/ and build/. */
const rootFiles = new Set([
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/NOTICE",
  "package/THIRD-PARTY-LICENSES.txt",
]);

/** Paths that must never ship: source maps, declarations, build info, unbundled deps. */
export const forbiddenTarballPath =
  /(?:^|\/)(?:src|test|tests|\.nerve|\.git|release|coverage|cache|node_modules)(?:\/|$)|\.(?:log|sqlite|db|node|map|tsbuildinfo)$|\.d\.[cm]?ts$/i;

export function verifyContents(entries: string[], filename: string) {
  for (const entry of bundleOutputFiles.map((file) => `package/${file}`))
    requireEntry(entries, entry, filename);
  for (const entry of entries) {
    if (
      entry === "package" ||
      rootFiles.has(entry) ||
      entry === "package/dist" ||
      entry.startsWith("package/dist/") ||
      entry === "package/build" ||
      entry.startsWith("package/build/")
    ) {
      if (forbiddenTarballPath.test(entry))
        throw new Error(`${filename}: forbidden packed path ${entry}.`);
      continue;
    }
    throw new Error(`${filename}: unexpected packed path ${entry}.`);
  }
  if (!entries.some((entry) => entry.startsWith("package/dist/web/assets/")))
    throw new Error(`${filename}: bundled workbench web assets are missing.`);
  if (!entries.some((entry) => entry.endsWith(".LEGAL.txt")))
    throw new Error(`${filename}: linked legal comments were not packed.`);
}

function verifyDesktopBin(tarball: string, filename: string) {
  const source = capture("tar", ["-xOzf", tarball, "package/dist/bin.js"]);
  if (!source.startsWith("#!/usr/bin/env node"))
    throw new Error(`${filename}: desktop bin is missing its Node shebang.`);
  // Windows filesystems do not expose Unix executable bits, so npm cannot
  // preserve one in tarballs packed there. The published tarball is built on
  // Linux, where this check still protects the installed CLI.
  if (process.platform !== "win32") {
    const verbose = capture("tar", ["-tvzf", tarball]);
    const line = verbose
      .split(/\r?\n/)
      .find((entry) => entry.trim().endsWith("package/dist/bin.js"));
    if (!line || !/^-rwx/.test(line.trim()))
      throw new Error(`${filename}: desktop bin is not executable.`);
  }
}

async function isolatedInstallSmoke(
  tarball: string,
  version: string,
  platformTarballs: Map<string, string>,
) {
  const directory = await mkdtemp(join(os.tmpdir(), "nerve-npm-smoke-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ name: "nerve-release-smoke", version: "1.0.0", private: true, type: "module", overrides: Object.fromEntries([...platformTarballs].map(([name, path]) => [name, `file:${path}`])) }, null, 2)}\n`,
    );
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      directory,
    );

    const lock = JSON.parse(
      await readFile(join(directory, "package-lock.json"), "utf8"),
    );
    if (JSON.stringify(lock).includes("workspace:"))
      throw new Error("isolated package-lock contains workspace references.");
    // Only the host's platform package may be installed (os/cpu/libc filtering).
    const installed = [...platformTarballs.keys()].filter((name) =>
      existsSync(join(directory, "node_modules", ...name.split("/"))),
    );
    const hostPackage = `@nervekit/native-${hostTriple()}`;
    if (installed.length !== 1 || installed[0] !== hostPackage)
      throw new Error(
        `expected only ${hostPackage} to be installed, found ${installed.join(", ") || "none"}.`,
      );

    const scoped = (
      await readdir(join(directory, "node_modules", "@nervekit"))
    ).sort();
    const expectedScoped = ["desktop", `native-${hostTriple()}`].sort();
    if (JSON.stringify(scoped) !== JSON.stringify(expectedScoped))
      throw new Error(
        `expected only ${expectedScoped.join(", ")} under node_modules/@nervekit, found ${scoped.join(", ")}.`,
      );

    const desktopRoot = join(directory, "node_modules", "@nervekit", "desktop");
    await checkBundleImports(desktopRoot);
    await smokeBundledDaemon(desktopRoot, version);
    await smokeWorkerEntrypoints(desktopRoot);

    const bin = join(desktopRoot, "dist", "bin.js");
    const versionOutput = capture(
      process.execPath,
      [bin, "--version"],
      directory,
    ).trim();
    if (versionOutput !== `@nervekit/desktop ${version}`)
      throw new Error(
        `desktop --version returned ${JSON.stringify(versionOutput)}.`,
      );
    const helpOutput = capture(process.execPath, [bin, "--help"], directory);
    if (
      !helpOutput.includes("Usage:") ||
      !helpOutput.includes("npx @nervekit/desktop@latest") ||
      !helpOutput.includes("--connect <url>")
    )
      throw new Error("desktop --help output is incomplete.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function hostTriple() {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  return `${process.platform}-${process.arch}-gnu`;
}

export function requireEntry(
  entries: string[],
  entry: string,
  filename: string,
) {
  if (!entries.includes(entry))
    throw new Error(`${filename}: missing ${entry}.`);
}

function extractJson(tarball: string, entry: string) {
  return JSON.parse(capture("tar", ["-xOzf", tarball, entry]));
}

function tarEntries(tarball: string) {
  return capture("tar", ["-tzf", tarball])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ""));
}

function capture(command: string, args: string[], cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

function run(command: string, args: string[], cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyNpmTarballs(
    process.argv[2] ? resolve(process.argv[2]) : undefined,
  );
}
