<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { scrollEdges } from "./scroll-edges.js";

/** A vertical scroll area whose overflow is stated by edge shadows instead of a
 * scrollbar. Lists, panels, and popover bodies all share it so "there is more
 * above/below" reads the same everywhere. The gradients blend into the surface
 * the region sits on, selected through `surface`. */
let {
  viewport = $bindable(),
  surface = "card",
  height,
  id,
  role,
  ariaLabel,
  class: className,
  viewportClass,
  contentClass,
  topShadowClass,
  children,
}: {
  viewport?: HTMLDivElement;
  /** Surface the shadows fade into; must match the region's background. */
  surface?: "card" | "popover";
  /** Pins the region's height instead of filling its flex parent. */
  height?: string;
  id?: string;
  role?: "listbox";
  ariaLabel?: string;
  class?: string;
  viewportClass?: string;
  contentClass?: string;
  topShadowClass?: string;
  children: Snippet;
} = $props();

let content = $state<HTMLDivElement>();
let canScrollUp = $state(false);
let canScrollDown = $state(false);

function updateShadows(): void {
  if (!viewport) return;
  const edges = scrollEdges(viewport);
  canScrollUp = edges.top;
  canScrollDown = edges.bottom;
}

$effect(() => {
  if (!viewport || !content) return;
  updateShadows();
  const observer = new ResizeObserver(updateShadows);
  observer.observe(viewport);
  observer.observe(content);
  return () => observer.disconnect();
});
</script>

<div
  class={cn(
    "scroll-region relative flex min-h-0 flex-col overflow-hidden",
    // A pinned region still yields to a short panel: it keeps its height as a
    // preference, not as a floor that would push a footer out of view.
    height ? "shrink" : "flex-1",
    className,
  )}
  class:scroll-region-popover={surface === "popover"}
  style:height
>
  <div
    bind:this={viewport}
    {id}
    {role}
    class={cn(
      "scroll-region-viewport min-h-0 flex-1 overflow-y-auto",
      viewportClass,
    )}
    aria-label={ariaLabel}
    onscroll={updateShadows}
  >
    <div bind:this={content} class={cn("min-w-0", contentClass)}>
      {@render children()}
    </div>
  </div>
  <div
    class={cn(
      "scroll-region-shadow scroll-region-shadow-top pointer-events-none absolute inset-x-0 h-6 opacity-0 transition-opacity duration-150",
      topShadowClass ?? "top-0",
      canScrollUp && "opacity-100",
    )}
  ></div>
  <div
    class="scroll-region-shadow scroll-region-shadow-bottom pointer-events-none absolute inset-x-0 bottom-0 h-10 opacity-0 transition-opacity duration-150"
    class:opacity-100={canScrollDown}
  ></div>
</div>

<style>
/* Native scrollbars are hidden because edge shadows provide the affordance. */
.scroll-region {
  --scroll-region-surface: var(--card);
}

.scroll-region-popover {
  --scroll-region-surface: var(--popover);
}

.scroll-region-viewport {
  scrollbar-width: none;
}

.scroll-region-viewport::-webkit-scrollbar {
  display: none;
}

/* The bottom edge hides the list's trailing padding as well as the clipped
 * row, so it fades over a taller band than the top edge. */
.scroll-region-shadow-bottom {
  background: linear-gradient(
    to top,
    var(--scroll-region-surface) 0%,
    var(--scroll-region-surface) 30%,
    color-mix(in oklab, var(--scroll-region-surface) 55%, transparent) 60%,
    transparent 100%
  );
}

.scroll-region-shadow-top {
  background: linear-gradient(
    to bottom,
    var(--scroll-region-surface) 0%,
    var(--scroll-region-surface) 22%,
    transparent 72%
  );
}
</style>
