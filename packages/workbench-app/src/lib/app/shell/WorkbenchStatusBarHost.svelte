<script lang="ts">
import {
  DOCK_IDS,
  DOCK_LABELS,
  type DockToggle,
} from "$lib/presentation/shell";
import StatusBar from "$lib/app/shell/StatusBar.svelte";
import { zoomState } from "$lib/platform/appearance/appearance.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";
import {
  hasPanelDockContent,
  isPanelDockVisible,
  shellSheets,
  togglePanelDock,
} from "$lib/app/shell/shell-layout.svelte";
import {
  conversationSelectors,
  openConversation,
} from "$lib/features/conversations";
import { gitSelectors } from "$lib/features/git";
import { taskSelectors } from "$lib/features/tasks";
import { settingsSelectors } from "$lib/features/settings";
import { setUiZoomLevel } from "$lib/application/settings";
import { usageSelectors } from "$lib/application/usage/usage-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace";

const activeProject = $derived(workspaceSelectors.activeProject);
const connection = $derived(workspaceSelectors.connection);
const live = $derived(conversationSelectors.live);
const pendingApprovals = $derived.by(() => {
  if (!activeProject) return [];
  return workspaceSelectors.approvals.filter(
    (approval) => approval.projectId === activeProject.id,
  );
});
const pendingApprovalCount = $derived(pendingApprovals.length);
const pendingApprovalConversationId = $derived(
  pendingApprovals[0]?.conversationId,
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

function openPendingApproval(): void {
  const conversationId = pendingApprovalConversationId;
  if (conversationId) void openConversation(conversationId);
}

// In compact mode the dock toggles drive the overlay sheets instead of the
// desktop collapse model; mirror the sheet state so the pressed affordance
// stays correct (open = panel visible).
const dockToggles = $derived<DockToggle[]>(
  DOCK_IDS.filter((dock) => dock !== "bottom" || hasPanelDockContent(dock)).map(
    (dock) => ({
      dock,
      label: DOCK_LABELS[dock].toLowerCase(),
      open: isCompact
        ? dock === "left"
          ? shellSheets.primary
          : shellSheets.secondary
        : isPanelDockVisible(dock),
      onToggle: () => togglePanelDock(dock, isCompact),
    }),
  ),
);
</script>

<StatusBar
  {activeProject}
  {connection}
  {live}
  pendingApprovals={pendingApprovalCount}
  onOpenPendingApproval={openPendingApproval}
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
