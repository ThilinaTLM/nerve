<!--
@component
Card holding one or more rows (a pull request with its checks); put `hoverable={false}` on inner `PanelRow`s.
-->

<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { ItemSurface } from "@nervekit/ui-kit/components/composites/item-surface";

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
  /** Marks this card as the list's current item. The card paints hover and selection; put `hoverable={false}` on inner rows. */
  selected?: boolean;
  /** Right-click menu of the card. */
  menuItems?: ContextMenuItem[];
  /** Suppresses the menu. */
  menuDisabled?: boolean;
  class?: string;
  /** Called when the card is activated. */
  onclick?: (event: MouseEvent) => void;
  children: Snippet;
} = $props();
</script>

<ItemSurface
  {role}
  tone="row"
  hover="row"
  {selected}
  {menuItems}
  {menuDisabled}
  class={`flex-col px-1 py-0.5 ${className ?? ""}`}
  {onclick}
>
  {@render children()}
</ItemSurface>
