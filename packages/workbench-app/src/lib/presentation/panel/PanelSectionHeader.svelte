<script lang="ts">
import type { Component, Snippet } from "svelte";

let {
  title,
  icon: Icon,
  count,
  meta,
  actions,
}: {
  title: string;
  icon?: Component;
  count?: number;
  meta?: Snippet;
  actions?: Snippet;
} = $props();
</script>

<div class="sticky top-0 z-1 flex h-7 items-center gap-1 bg-card">
  <div class="flex min-w-0 flex-1 items-center gap-1">
    {#if Icon}
      <Icon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    {/if}
    <span class="truncate text-xs font-semibold text-foreground">{title}</span>
    {#if count !== undefined}
      <span class="shrink-0 text-xs text-muted-foreground">{count}</span>
    {/if}
  </div>
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
