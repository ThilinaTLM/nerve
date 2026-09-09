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
  /** Subgroup label. Never the panel's title — that belongs to PopoverHeader. */
  label?: string;
  action?: Snippet;
  /** Adds the single hairline rule used between peer sections. */
  separated?: boolean;
  class?: string;
  children?: Snippet;
} = $props();
</script>

<section
  class={cn(
    "grid gap-1",
    separated && "border-t border-border/60 pt-2",
    className,
  )}
>
  {#if label || action}
    <div class="flex items-center justify-between gap-3 px-1.5 py-0.5">
      {#if label}<span class="text-xs text-muted-foreground">{label}</span>{/if}
      {#if action}{@render action()}{/if}
    </div>
  {/if}
  {@render children?.()}
</section>
