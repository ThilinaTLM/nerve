<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { Component, Snippet } from "svelte";

  type Props = {
    title: string;
    icon: Component;
    open?: boolean;
    /** Inline meta rendered before the action buttons (e.g. counts). */
    meta?: Snippet;
    /** Icon-only action buttons rendered on the right of the header. */
    actions?: Snippet;
    children: Snippet;
  };

  let {
    title,
    icon: Icon,
    open = $bindable(true),
    meta,
    actions,
    children,
  }: Props = $props();
</script>

<section class="border-b last:border-b-0">
  <div class="flex items-center gap-1 bg-muted/40 px-2 py-1.5">
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs font-medium text-foreground transition-colors hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {#if open}
        <ChevronDown size={13} strokeWidth={2.2} class="text-muted-foreground" />
      {:else}
        <ChevronRight size={13} strokeWidth={2.2} class="text-muted-foreground" />
      {/if}
      <Icon size={13} strokeWidth={2.2} class="text-muted-foreground" />
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
    <div class="px-3 pb-2.5">
      {@render children()}
    </div>
  {/if}
</section>
