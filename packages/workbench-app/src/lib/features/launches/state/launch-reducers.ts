import type { LaunchRecord } from "$lib/api";

export function resolveSelectedLaunchId(
  launches: LaunchRecord[],
  selectedLaunchId: string | undefined,
): string | undefined {
  if (
    selectedLaunchId &&
    launches.some((launch) => launch.id === selectedLaunchId)
  ) {
    return selectedLaunchId;
  }
  return launches[0]?.id;
}
