<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ariaLabel,
  class: className,
  children,
}: {
  ariaLabel?: string;
  class?: string;
  children: Snippet;
} = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    "divide-y divide-border overflow-hidden rounded-md border bg-card",
    // Inside a section surface the surface is the card: sit flush in it.
    "group-data-settings-surface/surface:-mx-3 group-data-settings-surface/surface:rounded-none group-data-settings-surface/surface:border-x-0 group-data-settings-surface/surface:border-y-0 group-data-settings-surface/surface:bg-transparent",
    className,
  )}
>
  {@render children()}
</div>
