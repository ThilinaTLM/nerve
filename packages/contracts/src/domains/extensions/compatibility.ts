/**
 * The oldest SDK version whose extensions this Nerve still loads. Raise it only when a release
 * breaks the extension API, the UI bridge, the manifest format, `ui-kit` components or theme token
 * names (see the installable extensions proposal, "Compatibility and versions").
 */
export const oldestCompatibleSdkVersion = "0.41.0";

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
 * undefined when `oldest <= sdkVersion <= nerveVersion`. The text is for the user.
 */
export function sdkCompatibilityProblem(
  sdkVersion: string,
  nerveVersion: string,
  oldest: string = oldestCompatibleSdkVersion,
): string | undefined {
  const old = compareVersions(sdkVersion, oldest);
  if (old !== undefined && old < 0)
    return `Built with SDK ${sdkVersion}; this Nerve needs ${oldest} or later. Ask the agent to upgrade it with the configure-nerve skill.`;
  const ahead = compareVersions(sdkVersion, nerveVersion);
  if (ahead !== undefined && ahead > 0)
    return `Built with SDK ${sdkVersion}, which is newer than this Nerve (${nerveVersion}). Update Nerve, or ask the agent to rebuild it for this version with the configure-nerve skill.`;
  return undefined;
}
