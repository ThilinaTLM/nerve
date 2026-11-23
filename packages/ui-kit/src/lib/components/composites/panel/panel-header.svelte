<!--
@component
First line of a panel: title, count and trailing icon actions (`PanelToolbarButton`s).
-->

<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  title,
  count,
  trailing,
  class: className,
}: {
  /** Panel title. */
  title: string;
  /** Number shown next to the title. */
  count?: number;
  /** Icon actions at the end of the line. */
  trailing?: Snippet;
  class?: string;
} = $props();
</script>

<div class={cn("flex h-7 min-w-0 shrink-0 items-center gap-1", className)}>
  <span class="truncate text-ui font-medium text-foreground">{title}</span>
  {#if count !== undefined}
    <span class="text-ui text-muted-foreground">{count}</span>
  {/if}
  {#if trailing}
    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      {@render trailing()}
    </div>
  {/if}
</div>
