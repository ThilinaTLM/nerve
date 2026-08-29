<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  label,
  action,
  separated = false,
  class: className,
  children,
}: {
  label?: string;
  action?: Snippet;
  /** Adds the single hairline rule used between peer sections. */
  separated?: boolean;
  class?: string;
  children?: Snippet;
} = $props();
</script>

<div
  class={cn(
    "grid gap-1.5",
    separated && "border-t border-border/60 pt-3",
    className,
  )}
>
  {#if label || action}
    <div class="flex items-baseline justify-between gap-3">
      {#if label}<span class="text-xs text-muted-foreground">{label}</span>{/if}
      {#if action}{@render action()}{/if}
    </div>
  {/if}
  {@render children?.()}
</div>
