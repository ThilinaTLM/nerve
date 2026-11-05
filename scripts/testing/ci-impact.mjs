#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE_PACKAGES = new Set([
  "@nervekit/contracts",
  "@nervekit/desktop-shell",
  "@nervekit/harness",
  "@nervekit/native",
  "@nervekit/protocol",
  "@nervekit/skills",
  "@nervekit/tools",
  "@nervekit/conversation-core",
  "@nervekit/ui-kit",
  "@nervekit/workbench-app",
  "@nervekit/workbench-server",
]);
const HOST_PACKAGES = new Set([
  "@nervekit/native",
  "@nervekit/harness",
  "@nervekit/skills",
  "@nervekit/tools",
  "@nervekit/conversation-core",
  "@nervekit/workbench-server",
]);
const WORKBENCH_PACKAGES = new Set([
  "@nervekit/workbench-app",
  "@nervekit/workbench-server",
]);
const GLOBAL_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  ".nvmrc",
  "eslint.config.js",
  "tsconfig.base.json",
]);
const IGNORED_ROOT_FILES = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "NOTICE",
]);
const SPECIAL_OWNERS = new Map([
  [
    "scripts/build/copy-workbench-app-dist-to-workbench-server.mjs",
    ["@nervekit/workbench-app", "@nervekit/workbench-server"],
  ],
  ["scripts/build/copy-skills-assets.mjs", ["@nervekit/skills"]],
  [
    "scripts/release/smoke-workbench-release.mjs",
    ["@nervekit/workbench-app", "@nervekit/workbench-server"],
  ],
  ["scripts/release/smoke-electron-image-resize.mjs", ["@nervekit/harness"]],
  ["scripts/build/generate-brand-assets.mjs", ["@nervekit/desktop-shell"]],
]);

// Developer tooling whose only CI consumer is the always-on lint job (format,
// lint, boundaries and the scripts/** test glob). These never reach a product
// package, so they must not escalate to full coverage. Build and release
// scripts stay unknown on purpose: they change what CI builds and ships.
const TOOLING_SCRIPT_PREFIXES = [
  "scripts/checks/",
  "scripts/development/",
  "scripts/storage-migrations/",
  "scripts/testing/",
];
const TOOLING_ROOT_FILES = new Set([
  ".c8rc.json",
  ".gitattributes",
  ".gitignore",
  ".oxfmtrc.json",
]);
// Platform order for native jobs; host work is split into parallel suites.
const NATIVE_OSES = ["windows-latest", "macos-latest"];
const HOST_SUITES = [
  "host-native",
  "host-server",
  "host-tools",
  "host-migrations",
];

export function loadWorkspace(root = repoRoot) {
  const packagesRoot = join(root, "packages");
  const packages = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    packages.set(manifest.name, {
      directory: `packages/${entry.name}`,
      dependencies: new Set(),
      scripts: manifest.scripts ?? {},
    });
  }

  for (const [name, workspacePackage] of packages) {
    const manifest = JSON.parse(
      readFileSync(
        join(root, workspacePackage.directory, "package.json"),
        "utf8",
      ),
    );
    for (const dependencyGroup of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ]) {
      for (const [dependencyName, version] of Object.entries(
        dependencyGroup ?? {},
      )) {
        if (
          packages.has(dependencyName) &&
          typeof version === "string" &&
          version.startsWith("workspace:")
        ) {
          workspacePackage.dependencies.add(dependencyName);
        }
      }
    }
    packages.set(name, workspacePackage);
  }
  return packages;
}

export function classifyChanges(changedPaths, workspace, options = {}) {
  const normalizedPaths = changedPaths
    .map(normalizePath)
    .filter((path) => path.length > 0);
  let full = options.full === true;
  const direct = new Set();
  let website = false;
  let electronSmoke = false;

  for (const path of normalizedPaths) {
    if (isGlobalPath(path)) {
      full = true;
      continue;
    }
    if (isIgnoredPath(path) || isToolingPath(path)) continue;

    const packageName = packageForPath(path, workspace);
    if (packageName) {
      direct.add(packageName);
      if (packageName === "@nervekit/website") website = true;
      if (path.startsWith("packages/ui-kit/src/styles/")) website = true;
      continue;
    }

    const owners = SPECIAL_OWNERS.get(path);
    if (owners) {
      for (const owner of owners) direct.add(owner);
      if (path === "scripts/release/smoke-electron-image-resize.mjs") {
        electronSmoke = true;
      }
      continue;
    }
    if (path.startsWith("assets/brand/")) {
      direct.add("@nervekit/desktop-shell");
      continue;
    }

    // Unknown executable/configuration ownership must never silently skip CI.
    full = true;
  }

  if (full) {
    for (const packageName of workspace.keys()) direct.add(packageName);
    website = true;
    electronSmoke = true;
  }

  const affected = reverseDependencyClosure(direct, workspace);
  const corePackages = sorted(
    [...affected].filter((packageName) => CORE_PACKAGES.has(packageName)),
  );
  const dependencyPackages = sorted(
    [...dependencyClosure(affected, workspace)].filter(
      (packageName) =>
        CORE_PACKAGES.has(packageName) && !affected.has(packageName),
    ),
  );
  const workbench = intersects(affected, WORKBENCH_PACKAGES);
  const nativeHost = intersects(affected, HOST_PACKAGES);
  const nativeDesktop = affected.has("@nervekit/desktop-shell");
  electronSmoke ||= affected.has("@nervekit/harness");
  const native =
    full ||
    workbench ||
    nativeHost ||
    nativeDesktop ||
    dependencyPackages.includes("@nervekit/native") ||
    corePackages.includes("@nervekit/native");
  const nativeMatrix = [];
  for (const os of NATIVE_OSES) {
    if (nativeHost) {
      for (const suite of HOST_SUITES) nativeMatrix.push({ os, suite });
    }
    if (nativeDesktop) nativeMatrix.push({ os, suite: "desktop" });
  }
  // One addon build per OS that has consumers (shared artifact).
  const nativeOsMatrix = NATIVE_OSES.filter((os) =>
    nativeMatrix.some((entry) => entry.os === os),
  ).map((os) => ({ os }));
  // cargo fmt/clippy are OS-independent and run once on Ubuntu. The Ubuntu
  // validate job already runs them whenever the native package itself is
  // selected, so only host-only selections need the dedicated job.
  const rustLint = nativeHost && !corePackages.includes("@nervekit/native");

  return {
    full,
    packages: corePackages,
    dependencyPackages,
    website,
    workbench,
    electronSmoke,
    native,
    nativeHost,
    nativeDesktop,
    nativeMatrix,
    nativeMatrixNeeded: nativeMatrix.length > 0,
    nativeOsMatrix,
    rustLint,
  };
}

export function githubOutputs(impact) {
  return {
    full: String(impact.full),
    packages: JSON.stringify(impact.packages),
    dependency_packages: JSON.stringify(impact.dependencyPackages),
    has_packages: String(impact.packages.length > 0),
    website: String(impact.website),
    workbench: String(impact.workbench),
    electron_smoke: String(impact.electronSmoke),
    native: String(impact.native),
    native_matrix: JSON.stringify({ include: impact.nativeMatrix }),
    native_matrix_needed: String(impact.nativeMatrixNeeded),
    native_os_matrix: JSON.stringify({ include: impact.nativeOsMatrix }),
    native_os_needed: String(impact.nativeOsMatrix.length > 0),
    rust_lint: String(impact.rustLint),
  };
}

export function reverseDependencyClosure(initial, workspace) {
  const result = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [packageName, workspacePackage] of workspace) {
      if (result.has(packageName)) continue;
      if ([...workspacePackage.dependencies].some((name) => result.has(name))) {
        result.add(packageName);
        changed = true;
      }
    }
  }
  return result;
}

export function dependencyClosure(initial, workspace) {
  const result = new Set(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const packageName = queue.shift();
    for (const dependency of workspace.get(packageName)?.dependencies ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      queue.push(dependency);
    }
  }
  return result;
}

export function packageForPath(path, workspace) {
  for (const [packageName, workspacePackage] of workspace) {
    if (
      path === workspacePackage.directory ||
      path.startsWith(`${workspacePackage.directory}/`)
    ) {
      return packageName;
    }
  }
  return undefined;
}

function isGlobalPath(path) {
  return (
    GLOBAL_FILES.has(path) ||
    path.startsWith(".github/workflows/") ||
    /^tsconfig(?:\.[^/]+)?\.json$/.test(path) ||
    /^eslint(?:\.[^/]+)?\.(?:js|mjs|cjs)$/.test(path) ||
    (path.startsWith("scripts/") &&
      !SPECIAL_OWNERS.has(path) &&
      !isToolingPath(path))
  );
}

function isToolingPath(path) {
  if (SPECIAL_OWNERS.has(path)) return false;
  return (
    TOOLING_ROOT_FILES.has(path) ||
    TOOLING_SCRIPT_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    /^scripts\/(?:[^/]+\/)*test\//.test(path)
  );
}

function isIgnoredPath(path) {
  return (
    IGNORED_ROOT_FILES.has(path) ||
    path.startsWith("docs/") ||
    (!path.startsWith("packages/website/") && path.endsWith(".md"))
  );
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value));
}

function sorted(values) {
  return values.sort((left, right) => left.localeCompare(right));
}

function normalizePath(path) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function parseArguments(argv) {
  const result = { head: "HEAD", full: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--full") result.full = true;
    else if (argument === "--base") result.base = argv[++index];
    else if (argument === "--head") result.head = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function readChangedPaths(base, head) {
  if (!base) throw new Error("A Git base revision is required");
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${base}...${head}`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workspace = loadWorkspace();
  let impact;
  try {
    const paths = options.full
      ? []
      : readChangedPaths(options.base, options.head);
    impact = classifyChanges(paths, workspace, { full: options.full });
  } catch (error) {
    console.error(
      `Could not determine affected CI scope; using full coverage: ${error instanceof Error ? error.message : String(error)}`,
    );
    impact = classifyChanges([], workspace, { full: true });
  }

  const outputs = githubOutputs(impact);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(outputs)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  }
  console.log(
    JSON.stringify({ ...impact, changedAgainst: options.base }, null, 2),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
