<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils.js";

  type Props = {
    items: T[];
    /** Fixed row height in pixels. */
    itemHeight: number;
    /** Extra rows rendered above/below the viewport. */
    overscan?: number;
    row: Snippet<[{ item: T; index: number }]>;
    keyFn?: (item: T, index: number) => string | number;
    class?: string;
  };

  let {
    items,
    itemHeight,
    overscan = 6,
    row,
    keyFn,
    class: className,
  }: Props = $props();

  let viewportEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);

  function handleScroll() {
    if (viewportEl) scrollTop = viewportEl.scrollTop;
  }

  $effect(() => {
    if (!viewportEl) return;
    viewportHeight = viewportEl.clientHeight;
    const observer = new ResizeObserver(() => {
      if (viewportEl) viewportHeight = viewportEl.clientHeight;
    });
    observer.observe(viewportEl);
    return () => observer.disconnect();
  });

  const total = $derived(items.length);
  const start = $derived(
    Math.max(0, Math.floor(scrollTop / itemHeight) - overscan),
  );
  const end = $derived(
    Math.min(
      total,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan,
    ),
  );
  const visible = $derived(items.slice(start, end));
</script>

<div
  bind:this={viewportEl}
  class={cn("virtual-list-viewport", className)}
  onscroll={handleScroll}
>
  <div class="virtual-list-spacer" style:height={`${total * itemHeight}px`}>
    {#each visible as item, i (keyFn ? keyFn(item, start + i) : start + i)}
      <div
        class="virtual-list-item"
        style:top={`${(start + i) * itemHeight}px`}
        style:height={`${itemHeight}px`}
      >
        {@render row({ item, index: start + i })}
      </div>
    {/each}
  </div>
</div>

<style>
  .virtual-list-viewport {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .virtual-list-spacer {
    position: relative;
    width: 100%;
  }

  .virtual-list-item {
    position: absolute;
    right: 0;
    left: 0;
    display: flex;
    align-items: center;
  }
</style>
