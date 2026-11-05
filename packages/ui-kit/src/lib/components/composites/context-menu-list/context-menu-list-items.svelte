<script lang="ts">
import { getContext } from "svelte";
import {
  CONTEXT_MENU_FOCUS_KEY,
  type ContextMenuFocusControl,
} from "./context-menu-focus";
import ContextMenuListItem from "./context-menu-list-item.svelte";
import ContextMenuListLabel from "./context-menu-list-label.svelte";
import ContextMenuListSeparator from "./context-menu-list-separator.svelte";
import ContextMenuListSub from "./context-menu-list-sub.svelte";
import type { ContextMenuItem } from "./context-menu-list.svelte";

let { items }: { items: ContextMenuItem[] } = $props();
const focus = getContext<ContextMenuFocusControl | undefined>(
  CONTEXT_MENU_FOCUS_KEY,
);
</script>

{#each items as item, index (index)}
  {#if item.type === "separator"}
    <ContextMenuListSeparator />
  {:else if item.type === "label"}
    <ContextMenuListLabel label={item.label} />
  {:else if item.type === "submenu"}
    <ContextMenuListSub
      label={item.label}
      icon={item.icon}
      disabled={item.disabled}
      items={item.items}
    />
  {:else}
    <ContextMenuListItem
      label={item.label}
      icon={item.icon}
      shortcut={item.shortcut}
      disabled={item.disabled}
      destructive={item.destructive}
      onSelect={() => {
        if (item.movesFocus) focus?.skipNextRestore();
        item.onSelect?.();
      }}
    />
  {/if}
{/each}
