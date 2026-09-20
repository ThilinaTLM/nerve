<script lang="ts">
import type { Snippet } from "svelte";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { PanelViewIcon } from "../shell-types.js";
import MobileActionSheet from "./MobileActionSheet.svelte";

/**
 * The single row shape used by every mobile list: a 44px-plus touch target with
 * one leading signal, a two-line text block, and an optional trailing count or
 * actions button.
 */
let {
  title,
  detail,
  meta,
  icon,
  tone,
  pulse = false,
  count,
  chevron = true,
  selected = false,
  menuItems,
  menuTitle,
  onclick,
  leading,
  trailing,
}: {
  title: string;
  detail?: string;
  /** Secondary label on the title line, e.g. the project name or a timestamp. */
  meta?: string;
  icon?: PanelViewIcon;
  tone?: StatusTone;
  pulse?: boolean;
  count?: number;
  chevron?: boolean;
  selected?: boolean;
  /** Renders an actions button that opens these items in a bottom sheet. */
  menuItems?: ContextMenuItem[];
  menuTitle?: string;
  onclick?: () => void;
  leading?: Snippet;
  trailing?: Snippet;
} = $props();

const Icon = $derived(icon);
const hasMenu = $derived(Boolean(menuItems?.length));
let menuOpen = $state(false);
</script>

<div class="mobile-row" class:selected>
  <button type="button" class="mobile-row-main" {onclick}>
    {#if leading}
      {@render leading()}
    {:else if Icon}
      <span
        class="flex size-8 flex-none items-center justify-center rounded-md bg-card text-muted-foreground"
      >
        <Icon size={17} strokeWidth={1.9} />
      </span>
    {:else if tone}
      <StatusDot {tone} {pulse} size="md" class="mt-1.5" />
    {/if}

    <span class="grid min-w-0 flex-1 gap-0.5 text-left">
      <span class="flex min-w-0 items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-sm text-foreground"
          >{title}</span
        >
        {#if meta}
          <span class="flex-none truncate text-xs text-muted-foreground"
            >{meta}</span
          >
        {/if}
      </span>
      {#if detail}
        <span class="line-clamp-2 text-xs text-muted-foreground">{detail}</span>
      {/if}
    </span>
  </button>

  {#if trailing}
    <span class="flex flex-none items-center pr-2">{@render trailing()}</span>
  {:else if count !== undefined && count > 0}
    <span
      class="flex-none self-center rounded-full bg-card px-1.5 py-0.5 text-xs text-muted-foreground"
      >{count}</span
    >
  {/if}

  {#if hasMenu && menuItems}
    <button
      type="button"
      class="mobile-row-action"
      aria-label={`Actions for ${title}`}
      aria-haspopup="dialog"
      onclick={() => (menuOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </button>
    <MobileActionSheet
      open={menuOpen}
      title={menuTitle ?? title}
      items={menuItems}
      onOpenChange={(open) => (menuOpen = open)}
    />
  {:else if chevron}
    <span class="mobile-row-chevron" aria-hidden="true">
      <ChevronRight size={16} strokeWidth={1.9} />
    </span>
  {/if}
</div>

<style>
.mobile-row {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 3.25rem;
}

.mobile-row.selected {
  background: color-mix(in oklab, var(--accent) 65%, transparent);
}

.mobile-row-main {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 0.625rem;
  min-width: 0;
  padding: 0.75rem 0.5rem 0.75rem 0.875rem;
  text-align: left;
}

.mobile-row-main:active {
  background: var(--accent);
}

/* A separate 44px target so the row tap and the menu tap never overlap. */
.mobile-row-action {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  color: var(--muted-foreground);
}

.mobile-row-action:active {
  color: var(--foreground);
  background: var(--accent);
}

.mobile-row-chevron {
  display: flex;
  flex: none;
  align-items: center;
  padding-right: 0.75rem;
  color: var(--muted-foreground);
}
</style>
