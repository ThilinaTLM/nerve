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

  const changedPaths = [];
  for (const { manifestPath, manifest } of manifests) {
    if (manifest.version === version) continue;
    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    changedPaths.push(relative(rootDirectory, manifestPath));
  }

  return changedPaths;
}
