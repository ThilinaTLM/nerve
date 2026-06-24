<script lang="ts">
  import Footerbar from "$lib/app/layout/Footerbar.svelte";
  import {
    closeDrawers,
    layout,
    openNavDrawer,
    openUtilityDrawer,
    setSidebarCollapsed,
    setUtilityCollapsed,
    zoomState,
  } from "$lib/app/layout/layout-state.svelte";
  import { responsive } from "$lib/app/layout/responsive.svelte";
  import { conversationSelectors } from "$lib/features/conversations";
  import { gitSelectors } from "$lib/features/git";
  import { taskSelectors } from "$lib/features/tasks";
  import { settingsSelectors, setUiZoomLevel } from "$lib/features/settings";
  import { usageSelectors } from "$lib/features/usage";
  import { workspaceSelectors } from "$lib/features/workspace";

  const activeProject = $derived(workspaceSelectors.activeProject);
  const connection = $derived(workspaceSelectors.connection);
  const live = $derived(conversationSelectors.live);
  const pendingApprovalCount = $derived(conversationSelectors.pendingApprovalCount);
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

  // In compact mode the panel toggles drive overlay drawers instead of the
  // desktop collapse model; mirror the drawer state into the collapsed prop so
  // the toggle icon/pressed affordance stays correct (collapsed = panel hidden).
  const sidebarCollapsed = $derived(
    isCompact ? !layout.navDrawerOpen : layout.sidebarCollapsed,
  );
  const utilityCollapsed = $derived(
    isCompact ? !layout.utilityDrawerOpen : layout.utilityCollapsed,
  );

  function toggleSidebar() {
    if (isCompact) {
      if (layout.navDrawerOpen) closeDrawers();
      else openNavDrawer();
    } else {
      setSidebarCollapsed(!layout.sidebarCollapsed);
    }
  }

  function toggleUtility() {
    if (isCompact) {
      if (layout.utilityDrawerOpen) closeDrawers();
      else openUtilityDrawer();
    } else {
      setUtilityCollapsed(!layout.utilityCollapsed);
    }
  }
</script>

<Footerbar
  {activeProject}
  {connection}
  {live}
  pendingApprovals={pendingApprovalCount}
  {tasks}
  {gitStatus}
  {subscriptionUsages}
  {status}
  homeDir={status?.storage.home}
  zoomLevel={currentZoomLevel}
  {sidebarCollapsed}
  {utilityCollapsed}
  phone={isPhone}
  onZoomLevelChange={setUiZoomLevel}
  onToggleSidebar={toggleSidebar}
  onToggleUtility={toggleUtility}
/>
