<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ariaLabel,
  class: className,
  children,
}: {
  /** Accessible name; also gives the container the `list` role. */
  ariaLabel?: string;
  class?: string;
  /** `PageItem`s. */
  children: Snippet;
} = $props();
</script>

<div
  role={ariaLabel ? "list" : undefined}
  aria-label={ariaLabel}
  class={cn(
    "divide-y divide-border overflow-hidden rounded-md border bg-card",
    // Inside a section surface the surface is the card: sit flush in it,
    // cancelling its padding on every side so row hover fills reach the edges,
    // and follow its corners so the fill is clipped by them.
    "group-not-data-page-divided/surface:group-data-page-surface/surface:-mx-3 group-not-data-page-divided/surface:group-data-page-surface/surface:-my-1.5 group-data-page-surface/surface:rounded-[inherit] group-data-page-surface/surface:border-x-0 group-data-page-surface/surface:border-y-0 group-data-page-surface/surface:bg-transparent",
    className,
  )}
>
  {@render children()}
</div>
