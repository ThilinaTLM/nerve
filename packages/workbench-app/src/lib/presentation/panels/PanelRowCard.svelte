<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { ItemSurface } from "$lib/presentation/items";

let {
  role = "none",
  selected = false,
  menuItems,
  menuDisabled = false,
  class: className,
  onclick,
  children,
}: {
  /** Outer semantics; rows inside already carry `listitem` where needed. */
  role?: "listitem" | "none";
  /** Marks this card as the list's current item. */
  selected?: boolean;
  menuItems?: ContextMenuItem[];
  menuDisabled?: boolean;
  class?: string;
  onclick?: (event: MouseEvent) => void;
  children: Snippet;
} = $props();
</script>

<ItemSurface
  {role}
  tone="row"
  {selected}
  {menuItems}
  {menuDisabled}
  class={`${selected ? "panel-row-card-selected " : ""}flex-col px-1 py-0.5 ${className ?? ""}`}
  {onclick}
>
  {@render children()}
</ItemSurface>
