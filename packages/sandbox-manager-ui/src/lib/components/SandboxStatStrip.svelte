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
  class={`flex flex-wrap items-stretch overflow-hidden rounded-md border bg-card ${className}`}
>
  {#each items as item, index (item.label)}
    {@const Icon = item.icon}
    <div
      class={`flex min-w-[8.5rem] flex-1 items-center gap-2 px-3 py-2 ${
        index > 0 ? "border-l" : ""
      }`}
    >
      <Icon class={`size-4 flex-none ${item.tone ?? "text-muted-foreground"}`} />
      <span class="text-sm font-semibold tabular-nums">{item.value}</span>
      <span class="truncate text-xs text-muted-foreground">{item.label}</span>
    </div>
  {/each}
</div>
