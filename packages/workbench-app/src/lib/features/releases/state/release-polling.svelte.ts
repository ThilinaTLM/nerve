import { queryClient, queryKeys } from "$lib/platform/query/client";
import { clientLog } from "$lib/platform/logging/client-logger";
import { createPoll } from "$lib/platform/polling/poll";
import { getLatestRelease } from "../api/releases.api";
import { releaseState } from "./release-state.svelte";

const RELEASE_REFRESH_INTERVAL_MS = 60 * 60_000;

const releasePoll = createPoll({
  intervalMs: RELEASE_REFRESH_INTERVAL_MS,
  immediate: true,
  run: async () => {
    releaseState.latest = await queryClient.fetchQuery({
      queryKey: queryKeys.latestRelease,
      queryFn: getLatestRelease,
      staleTime: 0,
    });
  },
  onError: (error) =>
    clientLog("warn", "releases", "Latest release check failed", { error }),
});

export function startReleasePolling(): void {
  // Restart so a reconnect refreshes immediately.
  releasePoll.stop();
  releasePoll.start();
}

export function stopReleasePolling(): void {
  releasePoll.stop();
}
