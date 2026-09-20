<script lang="ts">
import type { Snippet } from "svelte";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabMenuBuilder,
  WorkbenchTabModel,
  WorkbenchTabReorderHandler,
} from "./shell-types.js";
import EditorTabStrip from "./EditorTabStrip.svelte";

let {
  tabs = [],
  contentVisible,
  hideTabStrip = false,
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
  onReorder,
}: {
  tabs?: WorkbenchTabModel[];
  contentVisible?: boolean;
  /** Phone detail screens carry their own header, so the strip is dropped. */
  hideTabStrip?: boolean;
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
  onReorder?: WorkbenchTabReorderHandler;
} = $props();
</script>

<div
  class={hideTabStrip
    ? "grid h-full min-h-0 grid-rows-[minmax(0,1fr)]"
    : "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"}
>
  {#if hideTabStrip}
    <!-- The phone detail header replaces the strip; no row is reserved. -->
  {:else if tabStrip}
    {@render tabStrip()}
  {:else}
    <EditorTabStrip
      {tabs}
      {buildMenuItems}
      {onSelect}
      {onClose}
      {onRefresh}
      {onCloseOther}
      {onCloseRight}
      {onCloseLeft}
      {onNew}
      {onReorder}
    />
  {/if}
  <div class="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
    {#if contentVisible ?? tabs.length > 0}
      {@render content()}
    {:else if empty}
      {@render empty()}
    {/if}
  </div>
</div>
