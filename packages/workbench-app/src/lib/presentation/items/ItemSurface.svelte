<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import ContextMenuList from "@nervekit/ui-kit/components/composites/context-menu-list";
import { cn } from "@nervekit/ui-kit/utils";

type SurfaceElement = "div" | "section";
type SurfaceHover = "none" | "soft" | "default" | "row";
/** `card` keeps the recessed content slab; `row` stays flat so selection reads. */
type SurfaceTone = "card" | "row";

let {
  element = "div",
  role,
  id,
  tabindex,
  ariaLabel,
  ariaSelected,
  tone = "card",
  selected = false,
  hover = "none",
  focusWithin = false,
  menuItems,
  menuDisabled = false,
  menuTriggerClass = "contents",
  onMenuOpenChange,
  class: className,
  onclick,
  onkeydown,
  onfocus,
  ondblclick,
  children,
}: {
  element?: SurfaceElement;
  role?: string;
  id?: string;
  tabindex?: number;
  ariaLabel?: string;
  ariaSelected?: boolean;
  tone?: SurfaceTone;
  /** Marks the surface as the collection's current item. */
  selected?: boolean;
  hover?: SurfaceHover;
  focusWithin?: boolean;
  menuItems?: ContextMenuItem[];
  menuDisabled?: boolean;
  menuTriggerClass?: string;
  onMenuOpenChange?: (open: boolean) => void;
  class?: string;
  onclick?: (event: MouseEvent) => void;
  onkeydown?: (event: KeyboardEvent) => void;
  onfocus?: (event: FocusEvent) => void;
  ondblclick?: (event: MouseEvent) => void;
  children: Snippet;
} = $props();

const surfaceClass = $derived(
  cn(
    "flex min-w-0 rounded-md transition-colors",
    tone === "card" && "bg-muted",
    hover === "soft" && "hover:bg-hover",
    hover === "row" && "hover:bg-hover",
    hover === "default" && "hover:bg-hover",
    // Filled card surfaces step to the opaque accent instead of a translucent overlay.
    tone === "card" && hover !== "none" && "hover:bg-hover",
    // A clickable surface is clickable across its padding too.
    onclick && "cursor-pointer",
    focusWithin && "focus-within:bg-hover",
    // Selection wins over both tones and any hover step.
    selected &&
      "bg-selected font-medium text-foreground hover:bg-selected focus-within:bg-selected",
    className,
  ),
);
</script>

{#snippet surface()}
  <svelte:element
    this={element}
    {id}
    {role}
    {tabindex}
    aria-label={ariaLabel}
    aria-selected={ariaSelected}
    class={surfaceClass}
    {onclick}
    {onkeydown}
    {onfocus}
    {ondblclick}
  >
    {@render children()}
  </svelte:element>
{/snippet}

{#if menuItems && menuItems.length > 0}
  <ContextMenuList
    items={menuItems}
    disabled={menuDisabled}
    triggerClass={menuTriggerClass}
    onOpenChange={onMenuOpenChange}
  >
    {@render surface()}
  </ContextMenuList>
{:else}
  {@render surface()}
{/if}
