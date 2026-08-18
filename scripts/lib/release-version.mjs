import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export function assertReleaseVersion(version) {
  if (typeof version !== "string" || !version) {
    throw new Error("Release version is required.");
  }

  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(
      version,
    );
  if (!match) {
    throw new Error(
      `Invalid release version ${JSON.stringify(version)}. Expected canonical SemVer without a leading v or build metadata.`,
    );
  }

  const prerelease = match[4];
  if (
    prerelease
      ?.split(".")
      .some(
        (identifier) =>
          !identifier ||
          !/^[0-9A-Za-z-]+$/.test(identifier) ||
          (/^\d+$/.test(identifier) &&
            identifier.length > 1 &&
            identifier.startsWith("0")),
      )
  ) {
    throw new Error(
      `Invalid release version ${JSON.stringify(version)}. Prerelease identifiers must be canonical SemVer.`,
    );
  }

  return version;
}

export async function workspaceManifestPaths(rootDirectory) {
  const packagesDirectory = join(rootDirectory, "packages");
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const packageManifests = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDirectory, entry.name, "package.json"))
    .sort();

  if (packageManifests.length === 0) {
    throw new Error(
      `No workspace package manifests found in ${packagesDirectory}.`,
    );
  }

  return [join(rootDirectory, "package.json"), ...packageManifests];
}

export async function readRustReleaseVersions(rootDirectory) {
  const manifestPath = join(
    rootDirectory,
    "packages",
    "native",
    "native",
    "Cargo.toml",
  );
  const lockPath = join(rootDirectory, "Cargo.lock");
  const [manifest, lockfile] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(lockPath, "utf8"),
  ]);
  return {
    manifest: cargoManifestVersion(manifest, manifestPath),
    lockfile: cargoLockVersion(lockfile, lockPath),
  };
}

export async function setWorkspaceVersion(rootDirectory, version) {
  assertReleaseVersion(version);
  const manifestPaths = await workspaceManifestPaths(rootDirectory);
  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest.version !== "string" || !manifest.version) {
        throw new Error(
          `${relative(rootDirectory, manifestPath)} does not declare a version.`,
        );
      }
      return { manifestPath, manifest };
    }),
  );
  const cargoManifestPath = join(
    rootDirectory,
    "packages",
    "native",
    "native",
    "Cargo.toml",
  );
  const cargoLockPath = join(rootDirectory, "Cargo.lock");
  const [cargoManifest, cargoLock] = await Promise.all([
    readFile(cargoManifestPath, "utf8"),
    readFile(cargoLockPath, "utf8"),
  ]);
  const nextCargoManifest = replaceCargoManifestVersion(
    cargoManifest,
    version,
    cargoManifestPath,
  );
  const nextCargoLock = replaceCargoLockVersion(
    cargoLock,
    version,
    cargoLockPath,
  );

  const changedPaths = [];
  for (const { manifestPath, manifest } of manifests) {
    if (manifest.version === version) continue;
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    changedPaths.push(relative(rootDirectory, manifestPath));
  }
  for (const [path, current, next] of [
    [cargoManifestPath, cargoManifest, nextCargoManifest],
    [cargoLockPath, cargoLock, nextCargoLock],
  ]) {
    if (current === next) continue;
    await writeFile(path, next);
    changedPaths.push(relative(rootDirectory, path));
  }

  return changedPaths;
}

function cargoManifestVersion(source, path) {
  const block = uniqueTomlBlock(
    source,
    /^\[package\]\s*$/gm,
    path,
    "[package]",
    /^\[/gm,
  );
  const name = uniqueTomlString(block.text, "name", path);
  if (name !== "nerve-native") {
    throw new Error(
      `${path} [package] name is ${JSON.stringify(name)}, expected "nerve-native".`,
    );
  }
  return uniqueTomlString(block.text, "version", path);
}

function cargoLockVersion(source, path) {
  const blocks = tomlBlocks(source, /^\[\[package\]\]\s*$/gm);
  const matches = blocks.filter(
    (block) => tomlString(block.text, "name") === "nerve-native",
  );
  if (matches.length !== 1) {
    throw new Error(
      `${path} must contain exactly one nerve-native package entry; found ${matches.length}.`,
    );
  }
  return uniqueTomlString(matches[0].text, "version", path);
}

function replaceCargoManifestVersion(source, version, path) {
  const block = uniqueTomlBlock(
    source,
    /^\[package\]\s*$/gm,
    path,
    "[package]",
    /^\[/gm,
  );
  cargoManifestVersion(source, path);
  return replaceTomlString(source, block, "version", version, path);
}

function replaceCargoLockVersion(source, version, path) {
  const blocks = tomlBlocks(source, /^\[\[package\]\]\s*$/gm);
  const matches = blocks.filter(
    (block) => tomlString(block.text, "name") === "nerve-native",
  );
  if (matches.length !== 1) {
    throw new Error(
      `${path} must contain exactly one nerve-native package entry; found ${matches.length}.`,
    );
  }
  uniqueTomlString(matches[0].text, "version", path);
  return replaceTomlString(source, matches[0], "version", version, path);
}

function uniqueTomlBlock(source, pattern, path, label, endPattern = pattern) {
  const blocks = tomlBlocks(source, pattern, endPattern);
  if (blocks.length !== 1) {
    throw new Error(
      `${path} must contain exactly one ${label} block; found ${blocks.length}.`,
    );
  }
  return blocks[0];
}

function tomlBlocks(source, pattern, endPattern = pattern) {
  const starts = [...source.matchAll(pattern)].map((match) => match.index);
  const boundaries = [...source.matchAll(endPattern)].map(
    (match) => match.index,
  );
  return starts.map((start) => {
    const end =
      boundaries.find((boundary) => boundary > start) ?? source.length;
    return { start, end, text: source.slice(start, end) };
  });
}

function tomlString(source, key) {
  const matches = [
    ...source.matchAll(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "gm")),
  ];
  return matches.length === 1 ? matches[0][1] : undefined;
}

function uniqueTomlString(source, key, path) {
  const matches = [
    ...source.matchAll(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "gm")),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `${path} must declare exactly one ${key} in the native package block; found ${matches.length}.`,
    );
  }
  return matches[0][1];
}

function replaceTomlString(source, block, key, value, path) {
  const pattern = new RegExp(`^${key}\\s*=\\s*"[^"]+"\\s*$`, "gm");
  const matches = [...block.text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${path} must declare exactly one ${key} in the native package block; found ${matches.length}.`,
    );
  }
  const match = matches[0];
  const start = block.start + match.index;
  return `${source.slice(0, start)}${key} = "${value}"${source.slice(start + match[0].length)}`;
}
