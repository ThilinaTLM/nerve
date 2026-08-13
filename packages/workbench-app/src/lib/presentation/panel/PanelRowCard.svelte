<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { ItemSurface } from "$lib/presentation/items";

let {
  role = "none",
  itemKey,
  menuItems,
  menuDisabled = false,
  class: className,
  onclick,
  children,
}: {
  /** Outer semantics; rows inside already carry `listitem` where needed. */
  role?: "listitem" | "none";
  itemKey?: string;
  menuItems?: ContextMenuItem[];
  menuDisabled?: boolean;
  class?: string;
  onclick?: (event: MouseEvent) => void;
  children: Snippet;
} = $props();
</script>

<ItemSurface
  {role}
  {itemKey}
  {menuItems}
  {menuDisabled}
  class={`panel-row-card flex-col px-1 py-0.5 ${className ?? ""}`}
  {onclick}
>
  {@render children()}
</ItemSurface>
