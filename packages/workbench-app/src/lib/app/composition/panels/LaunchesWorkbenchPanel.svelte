<script lang="ts">
import LaunchesPanelHost from "$lib/features/launches/hosts/LaunchesPanelHost.svelte";
import {
  cancelSelectedLaunch,
  cleanupLaunchRuns,
  openLaunchTab,
  pruneFinishedLaunches,
  removeLaunch,
  restartSelectedLaunch,
  runLaunchCommand,
  launchSelectors,
} from "$lib/features/launches";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  activatePanelView,
  revealPanelView,
} from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const launches = $derived(launchSelectors.scopedLaunches);
const selectedLaunch = $derived(launchSelectors.activeCenterLaunch);

function focusLaunches() {
  revealPanelView("launches", responsive.isCompact);
  activatePanelView("launches");
}
</script>

<LaunchesPanelHost
  {activeProject}
  {launches}
  {selectedLaunch}
  homeDir={status?.storage.userHome}
  onOpenLaunchOutput={(id) => {
    focusLaunches();
    void openLaunchTab(id);
  }}
  onCancelLaunch={(id, request) => void cancelSelectedLaunch(id, request)}
  onRestartLaunch={(id) => void restartSelectedLaunch(id)}
  onRemoveLaunch={(id) => void removeLaunch(id)}
  onCleanupRuns={(ids) => void cleanupLaunchRuns(ids)}
  onPruneLaunches={() => void pruneFinishedLaunches()}
  onRunCommand={(input) => {
    focusLaunches();
    void runLaunchCommand(input);
  }}
/>
