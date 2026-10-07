import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const STORAGE_READ_COMPATIBILITY_FILE =
  "packages/workbench-server/src/infrastructure/storage-migrations/read-compatibility.ts";

const ENTRYPOINTS = [
  "packages/workbench-server/src/infrastructure/persistence/payloads/descriptors.ts",
  "packages/workbench-server/src/infrastructure/storage-migrations/runner/payload-sweep.ts",
];
const FORMAT_MARKER = "nerve-storage-read-compatibility-v1";

function normalize(path) {
  return path.split(sep).join("/");
}

function sourceImports(source) {
  const values = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*)\(?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function sourceCandidate(path) {
  const candidates = path.endsWith(".js")
    ? [path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx"]
    : path.endsWith(".ts") || path.endsWith(".tsx")
      ? [path]
      : [`${path}.ts`, `${path}.tsx`, resolve(path, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

function workspacePackages(repoRoot) {
  const packagesRoot = resolve(repoRoot, "packages");
  const result = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = resolve(packagesRoot, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name !== "string") continue;
    result.set(manifest.name, {
      root: dirname(manifestPath),
      manifest,
    });
  }
  return result;
}

function splitPackageSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name, ...rest] = specifier.split("/");
    return { packageName: `${scope}/${name}`, subpath: rest.join("/") };
  }
  const [packageName, ...rest] = specifier.split("/");
  return { packageName, subpath: rest.join("/") };
}

function workspaceExportSource(workspace, subpath) {
  const key = subpath ? `./${subpath}` : ".";
  const target = workspace.manifest.exports?.[key];
  const compiled =
    typeof target === "string"
      ? target
      : typeof target?.import === "string"
        ? target.import
        : typeof target?.types === "string"
          ? target.types
          : undefined;
  if (!compiled)
    throw new Error(
      `Storage reader import ${workspace.manifest.name}${subpath ? `/${subpath}` : ""} has no resolvable package export.`,
    );
  const source = compiled
    .replace(/^\.\/dist\//, "./src/")
    .replace(/\.d\.ts$/, ".ts")
    .replace(/\.js$/, ".ts");
  const candidate = sourceCandidate(resolve(workspace.root, source));
  if (!candidate)
    throw new Error(
      `Storage reader package export ${workspace.manifest.name}/${subpath} does not map to source.`,
    );
  return candidate;
}

function dependencyVersion(packages, importingFile, packageName) {
  let best;
  for (const workspace of packages.values()) {
    if (!importingFile.startsWith(`${workspace.root}${sep}`)) continue;
    best = workspace;
    break;
  }
  const version =
    best?.manifest.dependencies?.[packageName] ??
    best?.manifest.devDependencies?.[packageName];
  if (typeof version !== "string")
    throw new Error(
      `Storage reader imports external package ${packageName} without a declared version.`,
    );
  return version;
}

export function storageReadCompatibilityInputs(repoRoot) {
  const root = resolve(repoRoot);
  const packages = workspacePackages(root);
  const files = new Set();
  const dependencies = new Map();
  const pending = ENTRYPOINTS.map((entry) => resolve(root, entry));

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    if (!existsSync(file) || !statSync(file).isFile())
      throw new Error(
        `Storage reader compatibility input is missing: ${normalize(relative(root, file))}`,
      );
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of sourceImports(source)) {
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith(".")) {
        const candidate = sourceCandidate(resolve(dirname(file), specifier));
        if (!candidate)
          throw new Error(
            `Storage reader import ${specifier} from ${normalize(relative(root, file))} cannot be resolved.`,
          );
        pending.push(candidate);
        continue;
      }
      const { packageName, subpath } = splitPackageSpecifier(specifier);
      const workspace = packages.get(packageName);
      if (workspace) {
        pending.push(workspaceExportSource(workspace, subpath));
      } else {
        dependencies.set(
          packageName,
          dependencyVersion(packages, file, packageName),
        );
      }
    }
  }

  return {
    files: [...files].sort((left, right) =>
      normalize(relative(root, left)).localeCompare(
        normalize(relative(root, right)),
      ),
    ),
    dependencies: [...dependencies].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  };
}

export function storageReadCompatibilityId(repoRoot) {
  const root = resolve(repoRoot);
  const inputs = storageReadCompatibilityInputs(root);
  const hash = createHash("sha256");
  hash.update(FORMAT_MARKER);
  hash.update("\0");
  for (const file of inputs.files) {
    hash.update(normalize(relative(root, file)));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  for (const [name, version] of inputs.dependencies) {
    hash.update(`dependency:${name}@${version}`);
    hash.update("\0");
  }
  return `reader:${hash.digest("hex")}`;
}

export function renderStorageReadCompatibility(repoRoot) {
  const id = storageReadCompatibilityId(repoRoot);
  return `/** Generated by scripts/storage-migrations/update-read-compatibility.mjs. */\nexport const STORAGE_READ_COMPATIBILITY_ID =\n  ${JSON.stringify(id)};\n`;
}

export function updateStorageReadCompatibility(repoRoot) {
  const path = resolve(repoRoot, STORAGE_READ_COMPATIBILITY_FILE);
  writeFileSync(path, renderStorageReadCompatibility(repoRoot));
  return path;
}

export function storageReadCompatibilityPolicyViolations(repoRoot) {
  const root = resolve(repoRoot);
  if (!ENTRYPOINTS.some((entry) => existsSync(resolve(root, entry)))) return [];
  const path = resolve(root, STORAGE_READ_COMPATIBILITY_FILE);
  if (!existsSync(path))
    return [`${STORAGE_READ_COMPATIBILITY_FILE} is missing; run pnpm fix`];
  try {
    const expected = renderStorageReadCompatibility(repoRoot);
    const actual = readFileSync(path, "utf8");
    return actual === expected
      ? []
      : [`${STORAGE_READ_COMPATIBILITY_FILE} is stale; run pnpm fix`];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
