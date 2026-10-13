<script lang="ts">
import { LaunchOutputPane } from "$lib/features/launches/views";
import {
  loadEarlierLaunchLogs,
  loadLaunchLogWindow,
} from "$lib/features/launches/state/launch-logs.svelte";
import {
  cancelSelectedLaunch,
  cleanupLaunchRuns,
  restartSelectedLaunch,
} from "$lib/features/launches/state/launches.svelte";
import { launchSelectors } from "$lib/features/launches/state/launch-selectors.svelte";
import {
  selectLaunchEntryRun,
  launchEntryKey,
} from "$lib/features/launches/state/launch-tabs.svelte";

const activeCenterLaunch = $derived(launchSelectors.activeCenterLaunch);
const siblingRuns = $derived(launchSelectors.activeCenterLaunchRuns);
const launchLogs = $derived(
  launchSelectors.launchLogs?.launch.id === activeCenterLaunch?.id
    ? launchSelectors.launchLogs
    : undefined,
);
</script>

<LaunchOutputPane
  launch={activeCenterLaunch}
  {launchLogs}
  {siblingRuns}
  onSelectRun={(launchId) =>
    activeCenterLaunch
      ? selectLaunchEntryRun(launchEntryKey(activeCenterLaunch.id), launchId)
      : Promise.resolve()}
  onRestartRun={(launchId) => restartSelectedLaunch(launchId)}
  onCancelRun={(launchId) => cancelSelectedLaunch(launchId)}
  onForceKillRun={(launchId) =>
    cancelSelectedLaunch(launchId, {
      signal: "SIGKILL",
      reason: "force_kill",
    })}
  onCleanupRuns={(launchIds) => cleanupLaunchRuns(launchIds)}
  onLoadEarlier={() =>
    activeCenterLaunch
      ? loadEarlierLaunchLogs(activeCenterLaunch.id)
      : Promise.resolve()}
  onJumpToLatest={() =>
    activeCenterLaunch
      ? loadLaunchLogWindow(activeCenterLaunch.id)
      : Promise.resolve()}
/>
