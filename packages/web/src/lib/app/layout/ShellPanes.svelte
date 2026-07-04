<script lang="ts">
  import {
    Pane,
    PaneGroup,
    Handle as PaneResizer,
  } from "@nervekit/ui/components/ui/resizable";
  import * as Sheet from "@nervekit/ui/components/ui/sheet";
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

  // Chat-app feel: opening a conversation/tab from the navigator drawer dismisses
  // it. Track the active tab identity and close the drawer when it changes.
  let lastTabKey: string | undefined;
  $effect(() => {
    const key = activeCenterTab
      ? `${activeCenterTab.kind}:${activeCenterTab.id}`
      : undefined;
    if (key === lastTabKey) return;
    lastTabKey = key;
    if (layout.navDrawerOpen) closeDrawers();
  });

  // Returning to the desktop layout must not leave drawers mounted behind the
  // restored panes.
  $effect(() => {
    if (!isCompact && (layout.navDrawerOpen || layout.utilityDrawerOpen)) {
      closeDrawers();
    }
  });
</script>

{#if isCompact}
  <div class="workspace-shell compact">
    <div class="pane-shell center-shell">
      <CenterWorkspace />
    </div>
  </div>

  <Sheet.Root open={layout.navDrawerOpen} onOpenChange={setNavDrawerOpen}>
    <Sheet.Content side="left" class="sheet-pane">
      <Sheet.Title class="sr-only">Project navigator</Sheet.Title>
      <div class="pane-shell navigator-pane">
        <ProjectNavigatorShell />
      </div>
    </Sheet.Content>
  </Sheet.Root>

  <Sheet.Root open={layout.utilityDrawerOpen} onOpenChange={setUtilityDrawerOpen}>
    <Sheet.Content side="right" class="sheet-pane">
      <Sheet.Title class="sr-only">Utility panel</Sheet.Title>
      <div class="pane-shell utility-shell">
        <UtilityShell />
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <div class="workspace-shell">
    <PaneGroup
      direction="horizontal"
      autoSaveId="nerve.workspace.v3"
      keyboardResizeBy={8}
    >
      {#if !layout.sidebarCollapsed}
        <Pane defaultSize={19} minSize={14} maxSize={32} order={1}>
          <div class="pane-shell navigator-pane">
            <ProjectNavigatorShell />
          </div>
        </Pane>
        <PaneResizer aria-label="Resize agents panel" />
      {/if}

      <Pane defaultSize={57} minSize={38} order={2}>
        <div class="pane-shell center-shell">
          <CenterWorkspace />
        </div>
      </Pane>

      {#if !layout.utilityCollapsed}
        <PaneResizer aria-label="Resize utility panel" />
        <Pane defaultSize={24} minSize={19} maxSize={40} order={3}>
          <div class="pane-shell utility-shell">
            <UtilityShell />
          </div>
        </Pane>
      {/if}
    </PaneGroup>
  </div>
{/if}
