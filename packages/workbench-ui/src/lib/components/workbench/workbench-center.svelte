<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    WorkbenchTabIdentity,
    WorkbenchTabMenuBuilder,
    WorkbenchTabModel,
  } from "./types.js";
  import WorkbenchTabStrip from "./workbench-tab-strip.svelte";

  let {
    tabs = [],
    contentVisible,
    content,
    empty,
    tabStrip,
    buildMenuItems,
    onSelect,
    onClose,
    onRefresh,
    onCloseOther,
    onCloseRight,
    onCloseLeft,
    onNew,
  }: {
    tabs?: WorkbenchTabModel[];
    contentVisible?: boolean;
    content: Snippet;
    empty?: Snippet;
    tabStrip?: Snippet;
    buildMenuItems?: WorkbenchTabMenuBuilder;
    onSelect?: (tab: WorkbenchTabIdentity) => void;
    onClose?: (tab: WorkbenchTabIdentity) => void;
    onRefresh?: (tab: WorkbenchTabIdentity) => void;
    onCloseOther?: (tab: WorkbenchTabIdentity) => void;
    onCloseRight?: (tab: WorkbenchTabIdentity) => void;
    onCloseLeft?: (tab: WorkbenchTabIdentity) => void;
    onNew?: () => void;
  } = $props();
</script>

<div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
  {#if tabStrip}
    {@render tabStrip()}
  {:else}
    <WorkbenchTabStrip
      {tabs}
      {buildMenuItems}
      {onSelect}
      {onClose}
      {onRefresh}
      {onCloseOther}
      {onCloseRight}
      {onCloseLeft}
      {onNew}
    />
  {/if}
  <div class="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
    {#if contentVisible ?? (tabs.length > 0)}
      {@render content()}
    {:else if empty}
      {@render empty()}
    {/if}
  </div>
</div>
