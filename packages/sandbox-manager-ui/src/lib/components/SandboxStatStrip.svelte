<script lang="ts">
  import type { Component } from "svelte";

  export type StatItem = {
    label: string;
    value: string | number;
    icon: Component;
    tone?: string;
  };

  let {
    items,
    class: className = "",
  }: { items: StatItem[]; class?: string } = $props();
</script>

<div
  class={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-card px-3 py-2 ${className}`}
>
  {#each items as item, index (item.label)}
    {@const Icon = item.icon}
    <div class="flex items-center gap-2">
      <Icon class={`size-4 ${item.tone ?? "text-muted-foreground"}`} />
      <span class="text-sm font-semibold tabular-nums">{item.value}</span>
      <span class="text-xs text-muted-foreground">{item.label}</span>
    </div>
    {#if index < items.length - 1}
      <span class="hidden h-4 w-px bg-border sm:block" aria-hidden="true"></span>
    {/if}
  {/each}
</div>