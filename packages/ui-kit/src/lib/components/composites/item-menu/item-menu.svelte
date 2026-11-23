<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "../context-menu-list/index.js";
import { getItemMenuRenderer } from "./item-menu-renderer.js";

let {
  items,
  disabled = false,
  triggerClass,
  onOpenChange,
  children,
}: {
  /** Menu entries shown on the item's context-menu gesture. */
  items: ContextMenuItem[];
  /** Keep the item rendered but suppress the menu. */
  disabled?: boolean;
  /** Class for the element wrapping the item, when the renderer adds one. */
  triggerClass?: string;
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  children: Snippet;
} = $props();

const Renderer = $derived(getItemMenuRenderer());
</script>

<Renderer {items} {disabled} {triggerClass} {onOpenChange} {children} />
