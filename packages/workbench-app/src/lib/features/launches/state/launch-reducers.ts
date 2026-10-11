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

export function applyVisibleLaunchRecord(
  launches: LaunchRecord[],
  launch: LaunchRecord,
): LaunchRecord[] {
  if (launch.visibility === "foreground") {
    return launches.filter((item) => item.id !== launch.id);
  }

  const index = launches.findIndex((item) => item.id === launch.id);
  if (index < 0) return [launch, ...launches];

  return launches.map((item, itemIndex) =>
    itemIndex === index ? launch : item,
  );
}
