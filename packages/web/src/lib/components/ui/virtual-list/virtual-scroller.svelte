<script lang="ts" generics="T">
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { get } from "svelte/store";
  import { cn } from "$lib/core/utils.js";
  import type {
    VirtualScrollerController,
    VirtualScrollerProps,
  } from "./virtual-scroller-types";

  let {
    items,
    getKey,
    estimateSize,
    overscan = 8,
    anchor = "start",
    followOutput = false,
    scrollEndThreshold,
    paddingStart = 0,
    paddingEnd = 0,
    gap,
    controller = $bindable(),
    atEnd = $bindable(true),
    viewportClass,
    class: className,
    row,
  }: VirtualScrollerProps<T> = $props();

  let viewportEl = $state<HTMLDivElement | null>(null);

  const DEFAULT_ESTIMATE = 64;
  function resolveEstimate(index: number): number {
    return estimateSize?.(index) ?? DEFAULT_ESTIMATE;
  }

  // Created once per component instance. `getItemKey`/`estimateSize` read the
  // latest props by closure; everything else is reconciled via `setOptions`.
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
    count: 0,
    getScrollElement: () => viewportEl,
    estimateSize: (index) => resolveEstimate(index),
    getItemKey: (index) => getKey(items[index] as T, index),
  });

  // Stable instance reference (also ensures the adapter has attached its wrapped
  // `setOptions`). The adapter mutates and re-emits this SAME object on every
  // change, so Svelte's store->rune bridge can't detect updates by identity.
  // We therefore mirror the bits the template needs into plain `$state`, written
  // from the subscription callback below.
  const instance = get(virtualizer);

  let virtualItems = $state(instance.getVirtualItems());
  let totalSize = $state(instance.getTotalSize());

  function syncFromVirtualizer() {
    virtualItems = instance.getVirtualItems();
    totalSize = instance.getTotalSize();
    atEnd = instance.isAtEnd(scrollEndThreshold);
  }

  // Mount the virtualizer and mirror every internal notification into reactive
  // state. This is the single long-lived subscription for the component's life.
  $effect(() => {
    const unsubscribe = virtualizer.subscribe(syncFromVirtualizer);
    return unsubscribe;
  });

  // Reconcile dynamic options without recreating the virtualizer (preserves
  // scroll/measurement state). Touching `viewportEl` re-runs this once the
  // scroll element binds so `_willUpdate` can attach scroll listeners.
  $effect(() => {
    void viewportEl;
    instance.setOptions({
      count: items.length,
      overscan,
      anchorTo: anchor,
      followOnAppend: followOutput,
      paddingStart,
      paddingEnd,
      ...(scrollEndThreshold !== undefined ? { scrollEndThreshold } : {}),
      ...(gap !== undefined ? { gap } : {}),
    });
    syncFromVirtualizer();
  });

  // Raw scroll events update `atEnd` with sub-range precision (the virtualizer
  // only notifies on range changes, not every scrolled pixel).
  function handleScroll() {
    atEnd = instance.isAtEnd(scrollEndThreshold);
  }

  $effect(() => {
    controller = {
      scrollToEnd: (opts) => instance.scrollToEnd(opts),
      scrollToIndex: (index, opts) => instance.scrollToIndex(index, opts),
      isAtEnd: (threshold) => instance.isAtEnd(threshold ?? scrollEndThreshold),
      getDistanceFromEnd: () => instance.getDistanceFromEnd(),
      measureAll: () => instance.measure(),
    } satisfies VirtualScrollerController;
  });

  function measureNow(node: HTMLElement) {
    // Register the node for future resizes (async highlight, image/font load,
    // re-wrapping). The internal ResizeObserver also fires once on observe.
    instance.measureElement(node);
    // Force-apply the current height synchronously. virtual-core defers
    // measurement while `isScrolling` is true (e.g. mid-scroll or right after a
    // conversation switch), which would otherwise leave freshly-mounted rows at
    // the size estimate and overlapping their neighbours until the observer
    // catches up. `resizeItem` keeps virtual-core's scroll-anchor logic intact.
    const index = Number(node.dataset.index);
    if (!Number.isNaN(index)) {
      instance.resizeItem(index, node.offsetHeight);
    }
  }

  function measure(node: HTMLElement) {
    measureNow(node);
    return {
      update() {
        measureNow(node);
      },
    };
  }
</script>

<div
  bind:this={viewportEl}
  class={cn("virtual-scroller-viewport", viewportClass)}
  onscroll={handleScroll}
>
  <div
    class={cn("virtual-scroller-spacer", className)}
    style:height={`${totalSize}px`}
  >
    {#each virtualItems as virtualRow (virtualRow.key)}
      <div
        class="virtual-scroller-row"
        data-index={virtualRow.index}
        use:measure
        style:transform={`translateY(${virtualRow.start}px)`}
      >
        {@render row({
          item: items[virtualRow.index] as T,
          index: virtualRow.index,
        })}
      </div>
    {/each}
  </div>
</div>

<style>
  /* Rendered virtualization internals: the viewport scrolls and the spacer
     positions absolutely-placed rows. Escape-hatch layout scoped locally.
     Height is intentionally not set here — consumers size the viewport via
     `viewportClass` (e.g. `height: 100%` in a flex/grid cell, or `max-height`
     for an auto-sizing log box). */
  .virtual-scroller-viewport {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overflow-anchor: none;
  }

  .virtual-scroller-spacer {
    position: relative;
    width: 100%;
    min-width: 0;
  }

  .virtual-scroller-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    min-width: 0;
  }
</style>
