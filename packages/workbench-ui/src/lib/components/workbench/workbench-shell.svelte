<script lang="ts">
  import type { Snippet } from "svelte";
  import WorkbenchFrame from "./workbench-frame.svelte";
  import WorkbenchPanes from "./workbench-panes.svelte";
  import type {
    WorkbenchLayoutActions,
    WorkbenchShellModel,
  } from "./workbench-layout.js";

  let {
    model,
    actions = {},
    titlebar: titlebarContent,
    navigator: navigatorContent,
    center: centerContent,
    utility: utilityContent,
    footer: footerContent,
    overlays,
  }: {
    model: WorkbenchShellModel;
    actions?: WorkbenchLayoutActions;
    titlebar: Snippet;
    navigator: Snippet;
    center: Snippet;
    utility: Snippet;
    footer: Snippet;
    overlays?: Snippet;
  } = $props();
</script>

<WorkbenchFrame>
  {#snippet titlebar()}{@render titlebarContent()}{/snippet}
  {#snippet workspace()}
    <WorkbenchPanes
      compact={model.compact}
      sidebarCollapsed={model.sidebarCollapsed}
      utilityCollapsed={model.utilityCollapsed}
      navDrawerOpen={model.navDrawerOpen}
      utilityDrawerOpen={model.utilityDrawerOpen}
      autoSaveId={model.autoSaveId}
      leftLabel={model.leftLabel}
      rightLabel={model.rightLabel}
      onNavDrawerOpenChange={actions.onNavDrawerOpenChange}
      onUtilityDrawerOpenChange={actions.onUtilityDrawerOpenChange}
    >
      {#snippet left()}{@render navigatorContent()}{/snippet}
      {#snippet center()}{@render centerContent()}{/snippet}
      {#snippet right()}{@render utilityContent()}{/snippet}
    </WorkbenchPanes>
    {#if overlays}{@render overlays()}{/if}
  {/snippet}
  {#snippet footer()}{@render footerContent()}{/snippet}
</WorkbenchFrame>
