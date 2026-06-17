<script lang="ts">
  import {
    Pane,
    PaneGroup,
    Handle as PaneResizer,
  } from "$lib/components/ui/resizable";
  import { layout } from "$lib/app/layout/layout-state.svelte";
  import CenterWorkspace from "$lib/app/layout/CenterWorkspace.svelte";
  import UtilityShell from "$lib/app/layout/UtilityShell.svelte";
  import ProjectNavigatorShell from "$lib/features/projects/components/ProjectNavigatorShell.svelte";
</script>

<div class="workspace-shell">
  <PaneGroup direction="horizontal" autoSaveId="nerve.workspace.v3" keyboardResizeBy={8}>
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
