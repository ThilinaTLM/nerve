<script lang="ts">
  import { WorkbenchShell } from "@nervekit/workbench-ui/components/workbench";
  import BrowserNotificationPrompt from "$lib/features/notifications/BrowserNotificationPrompt.svelte";
  import DesktopShutdownOverlay from "$lib/app/layout/DesktopShutdownOverlay.svelte";
  import FooterbarContainer from "$lib/app/layout/FooterbarContainer.svelte";
  import ProjectDialogs from "$lib/app/layout/ProjectDialogs.svelte";
  import TitlebarContainer from "$lib/app/layout/TitlebarContainer.svelte";
  import CenterWorkspace from "$lib/app/layout/CenterWorkspace.svelte";
  import UtilityShell from "$lib/app/layout/UtilityShell.svelte";
  import {
    closeDrawers,
    layout,
    setNavDrawerOpen,
    setUtilityDrawerOpen,
  } from "$lib/app/layout/layout-state.svelte";
  import { responsive } from "$lib/app/layout/responsive.svelte";
  import ProjectNavigatorShell from "$lib/features/projects/components/ProjectNavigatorShell.svelte";
  import { workspaceSelectors } from "$lib/features/workspace";

  const isCompact = $derived(responsive.isCompact);
  const activeCenterTab = $derived(workspaceSelectors.activeCenterTab);

  let lastTabKey: string | undefined;
  $effect(() => {
    const key = activeCenterTab
      ? `${activeCenterTab.kind}:${activeCenterTab.id}`
      : undefined;
    if (key === lastTabKey) return;
    lastTabKey = key;
    if (layout.navDrawerOpen) closeDrawers();
  });

  $effect(() => {
    if (!isCompact && (layout.navDrawerOpen || layout.utilityDrawerOpen)) {
      closeDrawers();
    }
  });
</script>

<WorkbenchShell
  model={{
    compact: isCompact,
    sidebarCollapsed: layout.sidebarCollapsed,
    utilityCollapsed: layout.utilityCollapsed,
    navDrawerOpen: layout.navDrawerOpen,
    utilityDrawerOpen: layout.utilityDrawerOpen,
    autoSaveId: "nerve.workspace.v3",
    leftLabel: "Project navigator",
    rightLabel: "Utility panel",
  }}
  actions={{
    onNavDrawerOpenChange: setNavDrawerOpen,
    onUtilityDrawerOpenChange: setUtilityDrawerOpen,
  }}
>
  {#snippet titlebar()}<TitlebarContainer />{/snippet}
  {#snippet navigator()}<ProjectNavigatorShell />{/snippet}
  {#snippet center()}<CenterWorkspace />{/snippet}
  {#snippet utility()}<UtilityShell />{/snippet}
  {#snippet footer()}<FooterbarContainer />{/snippet}
  {#snippet overlays()}
    <BrowserNotificationPrompt />
    <DesktopShutdownOverlay />
  {/snippet}
</WorkbenchShell>

<ProjectDialogs />
