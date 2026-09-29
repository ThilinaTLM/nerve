<script lang="ts">
import type { Snippet } from "svelte";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import MobileActionSheet from "./MobileActionSheet.svelte";

/**
 * Titled group of mobile rows: one bordered card, hairline-divided rows. Menu
 * items add a section-wide actions button that opens a bottom sheet.
 */
let {
  title,
  meta,
  menuItems,
  menuTitle,
  children,
}: {
  title?: string;
  meta?: string;
  menuItems?: ContextMenuItem[];
  menuTitle?: string;
  children: Snippet;
} = $props();

let menuOpen = $state(false);
</script>

<section class="grid gap-1.5 px-3 py-2">
  {#if title}
    <h2
      class={menuItems?.length
        ? "-my-1 flex items-center gap-2 px-1"
        : "flex items-baseline gap-2 px-1"}
    >
      <span class="text-sm font-semibold text-foreground">{title}</span>
      {#if meta}<span class="text-xs text-muted-foreground">{meta}</span>{/if}
      {#if menuItems?.length}
        <Button
          variant="ghost"
          size="icon-sm"
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
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card);
}

.mobile-section-card > :global(* + *) {
  border-top: 1px solid var(--border);
}
</style>
