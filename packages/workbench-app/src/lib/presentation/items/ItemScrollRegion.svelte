<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import ItemCollection from "./ItemCollection.svelte";

let {
  viewport = $bindable(),
  activeKey,
  ariaLabel,
  class: className,
  viewportClass,
  contentClass,
  children,
}: {
  viewport?: HTMLDivElement;
  activeKey?: string;
  ariaLabel?: string;
  class?: string;
  viewportClass?: string;
  contentClass?: string;
  children: Snippet;
} = $props();

let content = $state<HTMLDivElement>();
let canScrollUp = $state(false);
let canScrollDown = $state(false);

function updateShadows(): void {
  if (!viewport) return;
  canScrollUp = viewport.scrollTop > 2;
  canScrollDown =
    viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2;
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
  class={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}
>
  <div
    bind:this={viewport}
    class={cn(
      "item-scroll-region min-h-0 flex-1 overflow-y-auto",
      viewportClass,
    )}
    aria-label={ariaLabel}
    onscroll={updateShadows}
  >
    <div bind:this={content} class="min-w-0">
      <ItemCollection {activeKey} class={contentClass}>
        {@render children()}
      </ItemCollection>
    </div>
  </div>
  <div
    class="item-scroll-shadow item-scroll-shadow-top pointer-events-none absolute inset-x-0 top-0 h-6 opacity-0 transition-opacity duration-150"
    class:opacity-100={canScrollUp}
  ></div>
  <div
    class="item-scroll-shadow item-scroll-shadow-bottom pointer-events-none absolute inset-x-0 bottom-0 h-6 opacity-0 transition-opacity duration-150"
    class:opacity-100={canScrollDown}
  ></div>
</div>

<style>
/* Native scrollbars are hidden because edge shadows provide the affordance. */
.item-scroll-region {
  scrollbar-width: none;
}

.item-scroll-region::-webkit-scrollbar {
  display: none;
}

.item-scroll-shadow-bottom {
  background: linear-gradient(
    to top,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}

.item-scroll-shadow-top {
  background: linear-gradient(
    to bottom,
    var(--card) 0%,
    var(--card) 22%,
    transparent 72%
  );
}
</style>
