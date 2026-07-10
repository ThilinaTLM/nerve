<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { Component, Snippet } from "svelte";
  import { cn } from "@nervekit/workbench-ui/core/utils";

  let {
    title,
    icon: Icon,
    open = $bindable(true),
    meta,
    actions,
    onOpenChange,
    contentClass,
    children,
  }: {
    title: string;
    icon?: Component;
    open?: boolean;
    meta?: Snippet;
    actions?: Snippet;
    onOpenChange?: (open: boolean) => void;
    contentClass?: string;
    children: Snippet;
  } = $props();

  function toggle(): void {
    open = !open;
    onOpenChange?.(open);
  }
</script>

<section class="overflow-hidden rounded-lg border bg-card">
  <div class={cn("flex items-center gap-1 px-2 py-1.5", open && "border-b")}>
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs font-semibold text-foreground transition-colors hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-expanded={open}
      onclick={toggle}
    >
      {#if open}
        <ChevronDown size={13} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
      {:else}
        <ChevronRight size={13} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
      {/if}
      {#if Icon}
        <Icon size={13} strokeWidth={2.2} class="shrink-0 text-muted-foreground" />
      {/if}
      <span class="truncate">{title}</span>
    </button>
    {#if meta}
      <div class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {@render meta()}
      </div>
    {/if}
    {#if actions}
      <div class="flex shrink-0 items-center gap-0.5">
        {@render actions()}
      </div>
    {/if}
  </div>
  {#if open}
    <div class={cn("px-3 py-2.5", contentClass)}>
      {@render children()}
    </div>
  {/if}
</section>
