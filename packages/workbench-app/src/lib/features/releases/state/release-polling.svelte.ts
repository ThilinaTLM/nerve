import { queryClient, queryKeys } from "$lib/platform/query/client";
import { clientLog } from "$lib/platform/logging/client-logger";
import { getLatestRelease } from "../api/releases.api";
import { releaseState } from "./release-state.svelte";

const RELEASE_REFRESH_INTERVAL_MS = 60 * 60_000;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;

export function startReleasePolling(): void {
  stopReleasePolling();
  void refreshLatestRelease();
  refreshTimer = setInterval(
    () => void refreshLatestRelease(),
    RELEASE_REFRESH_INTERVAL_MS,
  );
}

export function stopReleasePolling(): void {
  if (refreshTimer !== undefined) clearInterval(refreshTimer);
  refreshTimer = undefined;
}

async function refreshLatestRelease(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    releaseState.latest = await queryClient.fetchQuery({
      queryKey: queryKeys.latestRelease,
      queryFn: getLatestRelease,
      staleTime: 0,
    });
  } catch (error) {
    clientLog("warn", "releases", "Latest release check failed", { error });
  } finally {
    refreshing = false;
  }
}
