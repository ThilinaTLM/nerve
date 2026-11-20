/** What an extension was built against, one version floor each (see `oldestCompatibleSdkVersion`). */
export const extensionSurfaceNames = [
  "manifest",
  "backend",
  "ui",
  "themes",
] as const;
export type ExtensionSurface = (typeof extensionSurfaceNames)[number];

/** Words for a surface in a message to the user. */
const surfaceLabels: Record<ExtensionSurface, string> = {
  manifest: "manifest format",
  backend: "backend API",
  ui: "UI bridge and ui-kit components",
  themes: "theme tokens",
};

/**
 * The oldest SDK version whose extensions this Nerve still loads, per surface: `manifest` (the
 * `manifest.json` format), `backend` (the extension API and `ctx`), `ui` (the frame bridge and
 * `ui-kit`) and `themes` (token names). Raise one floor only when a release breaks that surface,
 * and add an `UPGRADING.md` section in the same change (see docs/architecture/extension-platform.md,
 * "Installed extensions"). An extension is checked only against the surfaces its manifest uses.
 */
export const oldestCompatibleSdkVersion: Record<ExtensionSurface, string> = {
  manifest: "0.41.0",
  backend: "0.41.0",
  ui: "0.41.0",
  themes: "0.41.0",
};

/**
 * The surfaces a manifest uses, read leniently from untrusted JSON (before the strict schema):
 * `manifest` always; `backend` with namespaces, tools or accounts; `ui` with previews, pages or
 * panels; `themes` with themes.
 */
export function usedExtensionSurfaces(manifest: unknown): ExtensionSurface[] {
  const record =
    manifest !== null && typeof manifest === "object"
      ? (manifest as Record<string, unknown>)
      : {};
  const filled = (value: unknown) =>
    Array.isArray(value)
      ? value.length > 0
      : value !== null &&
        typeof value === "object" &&
        Object.keys(value).length > 0;
  const ui =
    record.ui !== null && typeof record.ui === "object"
      ? (record.ui as Record<string, unknown>)
      : {};
  const used: ExtensionSurface[] = ["manifest"];
  if (
    filled(record.namespaces) ||
    filled(record.tools) ||
    filled(record.accounts)
  )
    used.push("backend");
  if (filled(ui.previews) || filled(ui.pages) || filled(ui.panels))
    used.push("ui");
  if (filled(ui.themes)) used.push("themes");
  return used;
}

type Version = { numbers: [number, number, number]; prerelease: string | null };

function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Negative when `a` is older than `b`; a prerelease is older than its release. Undefined for text that is not a version. */
export function compareVersions(a: string, b: string): number | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return undefined;
  for (let index = 0; index < 3; index++) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * Why an extension built with `sdkVersion` cannot load in the running Nerve (`nerveVersion`), or
 * undefined when every surface in `surfaces` has `floor <= sdkVersion <= nerveVersion`. The text
 * is for the user and names each surface that changed and the version that changed it.
 */
export function sdkCompatibilityProblem(
  sdkVersion: string,
  nerveVersion: string,
  surfaces: readonly ExtensionSurface[],
  oldest: Record<ExtensionSurface, string> = oldestCompatibleSdkVersion,
): string | undefined {
  const byFloor = new Map<string, string[]>();
  for (const surface of surfaces) {
    const floor = oldest[surface];
    const old = compareVersions(sdkVersion, floor);
    if (old !== undefined && old < 0)
      byFloor.set(floor, [
        ...(byFloor.get(floor) ?? []),
        surfaceLabels[surface],
      ]);
  }
  if (byFloor.size > 0) {
    const changes = [...byFloor]
      .map(
        ([floor, names]) =>
          `the ${names.join(" and the ")} changed in SDK ${floor}`,
      )
      .join("; ");
    return `Built with SDK ${sdkVersion}; ${changes}, and this Nerve needs the new one. Ask the agent in the Forge profile to upgrade it.`;
  }
  const ahead = compareVersions(sdkVersion, nerveVersion);
  if (ahead !== undefined && ahead > 0)
    return `Built with SDK ${sdkVersion}, which is newer than this Nerve (${nerveVersion}). Update Nerve, or ask the agent in the Forge profile to rebuild it for this version.`;
  return undefined;
}
