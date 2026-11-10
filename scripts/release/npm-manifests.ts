import type { PackageManifest } from "../workspace/repo.ts";
import type { NativePlatformPackage } from "./native-prebuilds.ts";

/**
 * Packages the esbuild bundle leaves external, so the published manifest keeps
 * them as real `dependencies`: Electron is the runtime host.
 * `@nervekit/native-*` platform packages are external too but
 * are declared as `optionalDependencies` instead. Everything else is bundled.
 */
export const externalRuntimeDependencies = ["electron"];

/**
 * Pure manifest assembly for the packed desktop distribution. Only the external
 * runtime packages stay dependencies; their ranges must agree across every
 * workspace package that declares them.
 */
export function collectDistributionDependencies(
  desktopManifest: PackageManifest,
  workspaceManifests: Iterable<PackageManifest>,
) {
  const ranges = new Map<string, string>();
  const record = (name: string, range: string) => {
    const existing = ranges.get(name);
    if (existing && existing !== range)
      throw new Error(
        `Conflicting runtime dependency ranges for ${name}: ${existing} and ${range}.`,
      );
    ranges.set(name, range);
  };
  const electronRange = desktopManifest.peerDependencies?.electron;
  if (!electronRange)
    throw new Error("desktop-shell must declare its Electron peer dependency.");
  record("electron", electronRange);
  for (const manifest of [desktopManifest, ...workspaceManifests])
    for (const [name, range] of Object.entries(manifest.dependencies ?? {}))
      if (externalRuntimeDependencies.includes(name)) record(name, range);

  const missing = externalRuntimeDependencies.filter(
    (name) => !ranges.has(name),
  );
  if (missing.length)
    throw new Error(
      `No workspace package declares external dependency ${missing.join(", ")}.`,
    );
  return Object.fromEntries(
    [...ranges.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Exact-version `optionalDependencies` pinning every per-platform native package. */
export function nativeOptionalDependencies(
  platformPackages: NativePlatformPackage[],
  version: string,
) {
  return Object.fromEntries(
    platformPackages
      .map((platformPackage) => [platformPackage.name, version])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Manifest for one `@nervekit/native-<triple>` package holding a single .node binary. */
export function nativePlatformManifest(
  platformPackage: NativePlatformPackage,
  nativeManifest: PackageManifest,
  version: string,
) {
  return {
    name: platformPackage.name,
    version,
    description: `Nerve native runtime binary for ${platformPackage.triple}.`,
    author: nativeManifest.author,
    license: nativeManifest.license,
    os: [platformPackage.os],
    cpu: [platformPackage.cpu],
    ...(platformPackage.libc ? { libc: platformPackage.libc } : {}),
    main: platformPackage.filename,
    files: [platformPackage.filename, "LICENSE", "NOTICE"],
    engines: nativeManifest.engines,
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/ThilinaTLM/nerve.git",
      directory: "packages/native",
    },
    homepage: "https://github.com/ThilinaTLM/nerve#readme",
  };
}
