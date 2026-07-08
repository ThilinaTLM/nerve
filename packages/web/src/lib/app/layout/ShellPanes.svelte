<script lang="ts">
  import { WorkbenchPanes } from "@nervekit/shared-ui/components/workbench";
  import {
    closeDrawers,
    layout,
    setNavDrawerOpen,
    setUtilityDrawerOpen,
  } from "$lib/app/layout/layout-state.svelte";
  import { responsive } from "$lib/app/layout/responsive.svelte";
  import CenterWorkspace from "$lib/app/layout/CenterWorkspace.svelte";
  import UtilityShell from "$lib/app/layout/UtilityShell.svelte";
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

<WorkbenchPanes
  compact={isCompact}
  sidebarCollapsed={layout.sidebarCollapsed}
  utilityCollapsed={layout.utilityCollapsed}
  navDrawerOpen={layout.navDrawerOpen}
  utilityDrawerOpen={layout.utilityDrawerOpen}
  autoSaveId="nerve.workspace.v3"
  leftLabel="Project navigator"
  rightLabel="Utility panel"
  onNavDrawerOpenChange={setNavDrawerOpen}
  onUtilityDrawerOpenChange={setUtilityDrawerOpen}
>
  {#snippet left()}
    <ProjectNavigatorShell />
  {/snippet}
  {#snippet center()}
    <CenterWorkspace />
  {/snippet}
  {#snippet right()}
    <UtilityShell />
  {/snippet}
</WorkbenchPanes>
