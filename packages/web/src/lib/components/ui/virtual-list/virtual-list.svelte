<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/core/utils.js";

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
  class={cn("h-full min-h-0 overflow-x-hidden overflow-y-auto", className)}
  onscroll={handleScroll}
>
  <div class="relative w-full" style:height={`${total * itemHeight}px`}>
    {#each visible as item, i (keyFn ? keyFn(item, start + i) : start + i)}
      <div
        class="absolute inset-x-0 flex items-center"
        style:top={`${(start + i) * itemHeight}px`}
        style:height={`${itemHeight}px`}
      >
        {@render row({ item, index: start + i })}
      </div>
    {/each}
  </div>
</div>
