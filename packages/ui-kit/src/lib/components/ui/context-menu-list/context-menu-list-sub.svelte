<script lang="ts">
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import ContextMenuListItems from "./context-menu-list-items.svelte";
import type { ContextMenuItem, MenuIcon } from "./context-menu-list.svelte";

let {
  label,
  icon,
  disabled = false,
  items,
  class: className,
}: {
  label: string;
  icon?: MenuIcon;
  disabled?: boolean;
  items: ContextMenuItem[];
  class?: string;
} = $props();
</script>

<ContextMenu.Sub>
  <ContextMenu.SubTrigger {disabled} class={className}>
    <span class="grid w-4 shrink-0 place-items-center">
      {#if icon}
        {@const Icon = icon}
        <Icon class="size-3.5" aria-hidden="true" />
      {/if}
    </span>
    <span class="truncate">{label}</span>
  </ContextMenu.SubTrigger>
  <ContextMenu.SubContent>
    <ContextMenuListItems {items} />
  </ContextMenu.SubContent>
</ContextMenu.Sub>
