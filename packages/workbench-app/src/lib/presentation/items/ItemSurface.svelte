<script lang="ts">
import type { Snippet } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import ContextMenuList from "@nervekit/ui-kit/components/ui/context-menu-list";
import { cn } from "@nervekit/ui-kit/core/utils";

type SurfaceElement = "div" | "section";
type SurfaceHover = "none" | "soft" | "default";

let {
  element = "div",
  role,
  id,
  tabindex,
  ariaLabel,
  ariaSelected,
  itemKey,
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
  itemKey?: string;
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
    "flex min-w-0 rounded-md bg-accent/60 transition-colors dark:bg-accent/35",
    hover === "soft" && "hover:bg-accent/80 dark:hover:bg-accent/40",
    hover === "default" && "hover:bg-accent/90 dark:hover:bg-accent/60",
    focusWithin && "focus-within:bg-accent/90 dark:focus-within:bg-accent/60",
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
    data-active-outline-key={itemKey}
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
