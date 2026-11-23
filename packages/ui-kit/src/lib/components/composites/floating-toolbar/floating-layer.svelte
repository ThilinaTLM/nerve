<!--
@component
Overlay for the floating chrome of a page, preview or panel. Place it inside a `relative` container that fills the frame (`<div class="relative h-screen">`), next to the content, not around it. One snippet per anchor, each stacking several items: `topStart` (identity, view choice), `topEnd` (actions on the content: find, copy, download, more), `bottomEnd` (spatial navigation: zoom), `bottomStart` (notices). `class` adjusts the insets (`pr-5` clears a scrollbar lane). Put the actions of a page in a `FloatingToolbar` here; do not build absolutely positioned bars.
-->

<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Items anchored to the top-left corner: identity and view choice. */
  topStart?: Snippet;
  /** Items anchored to the top-right corner: actions on the content. */
  topEnd?: Snippet;
  /** Items anchored to the bottom-left corner: notices. */
  bottomStart?: Snippet;
  /** Items anchored to the bottom-right corner: spatial navigation (zoom). */
  bottomEnd?: Snippet;
  /** Adjusts the insets, e.g. `pr-5` to clear a scrollbar lane. */
  class?: string;
};

let {
  topStart,
  topEnd,
  bottomStart,
  bottomEnd,
  class: className,
}: Props = $props();
</script>

<!-- Floating chrome of a pane: place it inside the pane's `relative` box. Each
     anchor stacks its items away from the edge. The two anchors of an edge
     share a wrapping row, so in a narrow pane the end anchor drops below the
     start anchor instead of overlapping it. The layer is a size container
     (`collapse` groups hide when it is narrow) and takes no pointer input;
     only the floating items do. -->
{#snippet anchor(
  content: Snippet | undefined,
  position: string,
  classes: string,
)}
  {#if content}
    <div
      class={cn("flex max-w-full min-w-0 flex-col gap-2", classes)}
      data-floating-anchor={position}
    >
      {@render content()}
    </div>
  {/if}
{/snippet}

<div
  class={cn(
    "@container pointer-events-none absolute inset-0 z-10 flex flex-col justify-between gap-2 p-3 font-sans",
    className,
  )}
  data-slot="floating-layer"
>
  <div class="flex flex-wrap items-start justify-between gap-2">
    {@render anchor(topStart, "top-start", "items-start")}
    {@render anchor(topEnd, "top-end", "ml-auto items-end")}
  </div>
  <div class="flex flex-wrap-reverse items-end justify-between gap-2">
    {@render anchor(
      bottomStart,
      "bottom-start",
      "flex-col-reverse items-start",
    )}
    {@render anchor(
      bottomEnd,
      "bottom-end",
      "ml-auto flex-col-reverse items-end",
    )}
  </div>
</div>
