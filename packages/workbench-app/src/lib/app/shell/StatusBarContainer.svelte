<script lang="ts">
import {
  DOCK_IDS,
  DOCK_LABELS,
  type DockToggle,
} from "$lib/presentation/shell";
import StatusBar from "$lib/app/shell/StatusBar.svelte";
import { zoomState } from "$lib/app/shell/appearance.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  isPanelDockVisible,
  shellSheets,
  togglePanelDock,
} from "$lib/app/shell/shell-layout.svelte";
import { conversationSelectors } from "$lib/features/conversations";
import { gitSelectors } from "$lib/features/git";
import { taskSelectors } from "$lib/features/tasks";
import { settingsSelectors, setUiZoomLevel } from "$lib/features/settings";
import { usageSelectors } from "$lib/features/usage";
import { workspaceSelectors } from "$lib/features/workspace";

const activeProject = $derived(workspaceSelectors.activeProject);
const connection = $derived(workspaceSelectors.connection);
const live = $derived(conversationSelectors.live);
const pendingApprovalCount = $derived(
  conversationSelectors.pendingApprovalCount,
);
const tasks = $derived(taskSelectors.scopedTasks);
const gitStatus = $derived(gitSelectors.gitStatus);
const subscriptionUsages = $derived(usageSelectors.subscriptionUsages);
const status = $derived(workspaceSelectors.status);
const settingsDraft = $derived(settingsSelectors.settingsDraft);
const currentZoomLevel = $derived(
  settingsDraft?.ui.zoomLevel ?? zoomState.level,
);

const isCompact = $derived(responsive.isCompact);
const isPhone = $derived(responsive.isPhone);

// In compact mode the dock toggles drive the overlay sheets instead of the
// desktop collapse model; mirror the sheet state so the pressed affordance
// stays correct (open = panel visible).
const dockToggles = $derived<DockToggle[]>(
  DOCK_IDS.map((dock) => ({
    dock,
    label: DOCK_LABELS[dock].toLowerCase(),
    open: isCompact
      ? dock === "left"
        ? shellSheets.primary
        : shellSheets.secondary
      : isPanelDockVisible(dock),
    onToggle: () => togglePanelDock(dock, isCompact),
  })),
);
</script>

<StatusBar
  {activeProject}
  {connection}
  {live}
  pendingApprovals={pendingApprovalCount}
  {tasks}
  {gitStatus}
  {subscriptionUsages}
  {status}
  homeDir={status?.storage.userHome}
  zoomLevel={currentZoomLevel}
  {dockToggles}
  phone={isPhone}
  onZoomLevelChange={setUiZoomLevel}
/>
