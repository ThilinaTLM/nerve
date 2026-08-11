<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  ariaLabel,
  contentClass,
  children,
}: {
  ariaLabel?: string;
  contentClass?: string;
  children: Snippet;
} = $props();

let region = $state<HTMLDivElement>();
let content = $state<HTMLDivElement>();
let canScrollUp = $state(false);
let canScrollDown = $state(false);

function updateShadows(): void {
  if (!region) return;
  canScrollUp = region.scrollTop > 2;
  canScrollDown =
    region.scrollTop + region.clientHeight < region.scrollHeight - 2;
}

$effect(() => {
  if (!region || !content) return;
  updateShadows();
  const observer = new ResizeObserver(updateShadows);
  observer.observe(region);
  observer.observe(content);
  return () => observer.disconnect();
});
</script>

<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
  <div
    bind:this={region}
    class="panel-scroll-region min-h-0 flex-1 overflow-y-auto"
    aria-label={ariaLabel}
    onscroll={updateShadows}
  >
    <div bind:this={content} class={cn("min-w-0", contentClass)}>
      {@render children()}
    </div>
  </div>
  <div
    class="panel-scroll-shadow panel-scroll-shadow-top pointer-events-none absolute inset-x-0 top-0 h-6 opacity-0 transition-opacity duration-150"
    class:opacity-100={canScrollUp}
  ></div>
  <div
    class="panel-scroll-shadow panel-scroll-shadow-bottom pointer-events-none absolute inset-x-0 bottom-0 h-6 opacity-0 transition-opacity duration-150"
    class:opacity-100={canScrollDown}
  ></div>
</div>

<style>
/* Escape-hatch reason 2: native scrollbars are hidden because edge shadows
 * provide the scroll affordance. */
.panel-scroll-region {
  scrollbar-width: none;
}

.panel-scroll-region::-webkit-scrollbar {
  display: none;
}

/* Gradients blend overflowing content into the panel surface. */
.panel-scroll-shadow-bottom {
  background: linear-gradient(
    to top,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}

.panel-scroll-shadow-top {
  background: linear-gradient(
    to bottom,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}
</style>
