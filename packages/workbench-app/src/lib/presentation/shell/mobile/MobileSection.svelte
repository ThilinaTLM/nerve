<script lang="ts">
import type { Snippet } from "svelte";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import MobileActionSheet from "./MobileActionSheet.svelte";

/**
 * Inset grouped list: an uppercase caption title (with optional count and
 * trailing link), then one rounded card whose rows are divided by inset
 * hairlines. Menu items add a section-wide actions button that opens a sheet.
 */
let {
  title,
  meta,
  action,
  menuItems,
  menuTitle,
  children,
}: {
  title?: string;
  meta?: string;
  /** Trailing link in the title row, e.g. "All 227". */
  action?: { label: string; onclick: () => void };
  menuItems?: ContextMenuItem[];
  menuTitle?: string;
  children: Snippet;
} = $props();

let menuOpen = $state(false);
</script>

<section class="mobile-section grid gap-1.5 px-3 py-2">
  {#if title}
    <h2
      class={menuItems?.length
        ? "-my-1 flex items-center gap-2 px-1"
        : "flex items-center gap-2 px-1"}
    >
      <span
        class="text-caption font-medium uppercase tracking-wide text-muted-foreground"
        >{title}</span
      >
      {#if meta}
        <span class="text-caption text-muted-foreground">{meta}</span>
      {/if}
      {#if action}
        <button
          type="button"
          class="ml-auto -my-2 inline-flex min-h-11 items-center px-1 text-caption text-primary"
          onclick={action.onclick}>{action.label}</button
        >
      {/if}
      {#if menuItems?.length}
        <Button
          variant="ghost"
          size="icon"
          class="ml-auto"
          ariaLabel={`${title} actions`}
          aria-haspopup="dialog"
          onclick={() => (menuOpen = true)}
        >
          <EllipsisVertical size={18} strokeWidth={1.9} />
        </Button>
      {/if}
    </h2>
  {/if}
  <div class="mobile-section-card">
    {@render children()}
  </div>
</section>

{#if menuItems?.length}
  <MobileActionSheet
    open={menuOpen}
    title={menuTitle ?? title ?? "Actions"}
    items={menuItems}
    onOpenChange={(open) => (menuOpen = open)}
  />
{/if}

<style>
.mobile-section-card {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--card);
  --well: var(--well-on-card);
}

/* The last row ends the card, so its inset hairline would double the border. */
.mobile-section-card
  > :global(.mobile-row:last-child .mobile-row-surface::after) {
  display: none;
}

/* Rows that are not MobileListRow (custom children) keep a full-width divider. */
.mobile-section-card > :global(*:not(.mobile-row) + *:not(.mobile-row)) {
  border-top: 1px solid var(--border-subtle);
}
</style>
