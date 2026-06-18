<script lang="ts">
  import Footerbar from "$lib/app/layout/Footerbar.svelte";
  import {
    layout,
    setSidebarCollapsed,
    setUtilityCollapsed,
    zoomState,
  } from "$lib/app/layout/layout-state.svelte";
  import { conversationSelectors } from "$lib/features/conversations";
  import { gitSelectors } from "$lib/features/git";
  import { processSelectors } from "$lib/features/processes";
  import { settingsSelectors, setUiZoomLevel } from "$lib/features/settings";
  import { usageSelectors } from "$lib/features/usage";
  import { workspaceSelectors } from "$lib/features/workspace";

  const activeProject = $derived(workspaceSelectors.activeProject);
  const activeConversation = $derived(conversationSelectors.activeConversation);
  const activeAgent = $derived(conversationSelectors.activeAgent);
  const connection = $derived(workspaceSelectors.connection);
  const live = $derived(conversationSelectors.live);
  const pendingApprovalCount = $derived(conversationSelectors.pendingApprovalCount);
  const processes = $derived(processSelectors.scopedProcesses);
  const branchDepth = $derived(gitSelectors.branchDepth);
  const gitStatus = $derived(gitSelectors.gitStatus);
  const subscriptionUsage = $derived(usageSelectors.activeSubscriptionUsage);
  const status = $derived(workspaceSelectors.status);
  const settingsDraft = $derived(settingsSelectors.settingsDraft);
  const currentZoomLevel = $derived(
    settingsDraft?.ui.zoomLevel ?? zoomState.level,
  );
</script>

<Footerbar
  {activeProject}
  {activeConversation}
  {activeAgent}
  {connection}
  {live}
  pendingApprovals={pendingApprovalCount}
  {processes}
  {branchDepth}
  {gitStatus}
  {subscriptionUsage}
  homeDir={status?.storage.home}
  zoomLevel={currentZoomLevel}
  sidebarCollapsed={layout.sidebarCollapsed}
  utilityCollapsed={layout.utilityCollapsed}
  onZoomLevelChange={setUiZoomLevel}
  onToggleSidebar={() => setSidebarCollapsed(!layout.sidebarCollapsed)}
  onToggleUtility={() => setUtilityCollapsed(!layout.utilityCollapsed)}
/>
