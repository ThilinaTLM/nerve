import type { LaunchLogQueryResponse, LaunchRecord } from "$lib/api";

export const launchState = $state({
  launches: [] as LaunchRecord[],
  selectedLaunchId: undefined as string | undefined,
  launchLogs: undefined as LaunchLogQueryResponse | undefined,
  selectedRunByEntry: {} as Record<string, string>,
  openLaunchTabIds: [] as string[],
});
