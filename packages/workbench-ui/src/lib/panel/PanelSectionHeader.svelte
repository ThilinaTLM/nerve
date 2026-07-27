<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { Component, Snippet } from "svelte";

let {
  title,
  icon: Icon,
  open,
  count,
  meta,
  actions,
  onToggle,
}: {
  title: string;
  icon?: Component;
  /** Omit to render a static (non-collapsible) header. */
  open?: boolean;
  count?: number;
  meta?: Snippet;
  actions?: Snippet;
  onToggle?: () => void;
} = $props();

const collapsible = $derived(open !== undefined && onToggle !== undefined);
</script>

<div
  class="panel-section-header group/section-header flex h-7 items-center gap-1 pr-1.5 pl-2"
>
  {#if collapsible}
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-expanded={open}
      onclick={onToggle}
    >
      {#if open}
        <ChevronDown
          class="size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {:else}
        <ChevronRight
          class="size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
      {#if Icon}
        <Icon
          class="size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
      <span
        class="truncate text-xs font-semibold tracking-wide text-foreground uppercase"
        >{title}</span
      >
      {#if count !== undefined}
        <span class="shrink-0 text-xs text-muted-foreground">{count}</span>
      {/if}
    </button>
  {:else}
    <div class="flex min-w-0 flex-1 items-center gap-1">
      {#if Icon}
        <Icon
          class="size-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
      <span
        class="truncate text-xs font-semibold tracking-wide text-foreground uppercase"
        >{title}</span
      >
      {#if count !== undefined}
        <span class="shrink-0 text-xs text-muted-foreground">{count}</span>
      {/if}
    </div>
  {/if}
  {#if meta}
    <div class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      {@render meta()}
    </div>
  {/if}
  {#if actions}
    <div
      class="panel-hover-actions flex shrink-0 items-center gap-0.5 group-focus-within/section-header:opacity-100 group-hover/section-header:opacity-100"
    >
      {@render actions()}
    </div>
  {/if}
</div>
