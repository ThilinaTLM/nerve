import type { PackageManifest } from "../workspace/repo.ts";
import { bundledPackages as internalPackages } from "./workspace-packages.ts";

const internalNames = new Set(internalPackages.map(([name]) => name));

/**
 * Pure manifest assembly for the packed desktop distribution: external runtime
 * dependency ranges must agree across bundled packages, and bundled `@nervekit/*`
 * packages are pinned to the release version.
 */
export function collectDistributionDependencies(
  desktopManifest: PackageManifest,
  internalManifests: Map<string, PackageManifest>,
  version: string,
) {
  const external = new Map();
  const addDependencies = (manifest: PackageManifest) => {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (internalNames.has(name)) continue;
      const existing = external.get(name);
      if (existing && existing !== range)
        throw new Error(
          `Conflicting runtime dependency ranges for ${name}: ${existing} and ${range}.`,
        );
      external.set(name, range);
    }
  };
  addDependencies(desktopManifest);
  for (const manifest of internalManifests.values()) addDependencies(manifest);

  const electronRange = desktopManifest.peerDependencies?.electron;
  if (!electronRange)
    throw new Error("desktop-shell must declare its Electron peer dependency.");
  external.set("electron", electronRange);

  return Object.fromEntries(
    [
      ...internalPackages.map(([name]) => [name, version]),
      ...[...external.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function embeddedManifest(manifest: PackageManifest, version: string) {
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, range]) => [
      name,
      internalNames.has(name) ? version : range,
    ]),
  );
  return Object.fromEntries(
    Object.entries({
      name: manifest.name,
      version,
      description: manifest.description,
      author: manifest.author,
      license: manifest.license,
      type: manifest.type,
      main: manifest.main,
      exports: manifest.exports,
      dependencies,
      engines: manifest.engines,
    }).filter(([, value]) => value !== undefined),
  );
}
