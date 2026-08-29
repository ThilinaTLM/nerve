<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  title,
  meta,
  action,
  class: className,
}: {
  title: string;
  /** Muted trailing text (e.g. "Updated 02:00 AM"). */
  meta?: string;
  /** Trailing element (badge, link, tone-colored value). Wins over `meta`. */
  action?: Snippet;
  class?: string;
} = $props();
</script>

<div class={cn("flex items-baseline justify-between gap-3", className)}>
  <strong class="text-sm font-semibold">{title}</strong>
  {#if action}
    {@render action()}
  {:else if meta}
    <span class="flex-none text-xs text-muted-foreground">{meta}</span>
  {/if}
</div>
