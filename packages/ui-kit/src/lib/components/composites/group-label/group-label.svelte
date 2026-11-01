<script lang="ts">
import type { Component } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

/* The caption above a group of rows (Pinned, Today, Connections): sentence
 * case, never an all-caps eyebrow. A section heading with actions is
 * PanelSectionHeader; this is only the quiet label. */
let {
  label,
  count,
  icon: Icon,
  class: className,
}: {
  label: string;
  count?: number;
  icon?: Component;
  class?: string;
} = $props();
</script>

<p
  class={cn(
    "flex min-w-0 items-center gap-1.5 text-caption font-medium text-muted-foreground",
    className,
  )}
>
  {#if Icon}<Icon class="size-3 shrink-0" aria-hidden="true" />{/if}
  <span class="truncate">{label}</span>
  {#if count !== undefined}<span class="font-normal tabular-nums">{count}</span
    >{/if}
</p>
