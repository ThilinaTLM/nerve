<script lang="ts" generics="T">
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { get } from "svelte/store";
  import { cn } from "$lib/core/utils.js";
  import { getRowHeightCache } from "./row-height-cache";
  import type {
    VirtualScrollBehavior,
    VirtualScrollerController,
    VirtualScrollerProps,
  } from "./virtual-scroller-types";

  let {
    items,
    getKey,
    estimateSize,
    heightCacheKey,
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

  // Persisted per-scope height cache (seeded into `estimateSize` so remounts
  // paint at real height without a synchronous reflow). Resolved reactively in
  // case the scope key changes for a live instance.
  const heightCache = $derived(
    heightCacheKey ? getRowHeightCache(heightCacheKey) : undefined,
  );

  function itemKeyForIndex(index: number): string | number {
    const item = items[index];
    return item === undefined ? `__missing__:${index}` : getKey(item, index);
  }

  function resolveEstimate(index: number): number {
    const cached = heightCache?.get(itemKeyForIndex(index));
    if (cached !== undefined) return cached;
    return estimateSize?.(index) ?? DEFAULT_ESTIMATE;
  }

  // Created once per component instance. `getItemKey`/`estimateSize` read the
  // latest props by closure; everything else is reconciled via `setOptions`.
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
    count: 0,
    getScrollElement: () => viewportEl,
    estimateSize: (index) => resolveEstimate(index),
    getItemKey: itemKeyForIndex,
  });

  // Stable instance reference (also ensures the adapter has attached its wrapped
  // `setOptions`). The adapter mutates and re-emits this SAME object on every
  // change, so Svelte's store->rune bridge can't detect updates by identity.
  // We therefore mirror the bits the template needs into plain `$state`, written
  // from the subscription callback below.
  const instance = get(virtualizer);

  let virtualItems = $state(instance.getVirtualItems());
  let totalSize = $state(instance.getTotalSize());
  const renderedVirtualItems = $derived(
    virtualItems.filter(
      (virtualRow) => virtualRow.index >= 0 && virtualRow.index < items.length,
    ),
  );

  const FOLLOW_SETTLE_FRAMES = 8;
  let followFrame: number | undefined;
  let followSettleFrames = 0;

  function shouldFollowEnd(): boolean {
    return anchor === "end" && Boolean(followOutput);
  }

  function followBehavior(): VirtualScrollBehavior {
    return followOutput === "smooth" ? "smooth" : "auto";
  }

  function cancelFollowFrame() {
    if (followFrame === undefined) return;
    cancelAnimationFrame(followFrame);
    followFrame = undefined;
  }

  function scheduleFollowToEnd(settleFrames = FOLLOW_SETTLE_FRAMES) {
    if (!shouldFollowEnd()) return;
    followSettleFrames = Math.max(followSettleFrames, settleFrames);
    if (followFrame !== undefined) return;

    followFrame = requestAnimationFrame(() => {
      followFrame = undefined;
      if (!shouldFollowEnd()) {
        followSettleFrames = 0;
        return;
      }

      instance.scrollToEnd({ behavior: followBehavior() });
      syncFromVirtualizer();
      followSettleFrames -= 1;
      if (followSettleFrames > 0 && !instance.isAtEnd(scrollEndThreshold)) {
        scheduleFollowToEnd(followSettleFrames);
      } else {
        followSettleFrames = 0;
      }
    });
  }

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

  let itemEdgeSignature = "";

  // Reconcile dynamic options without recreating the virtualizer (preserves
  // scroll/measurement state). Touching `viewportEl` re-runs this once the
  // scroll element binds so `_willUpdate` can attach scroll listeners.
  $effect(() => {
    void viewportEl;
    const nextEdgeSignature =
      items.length === 0
        ? "0"
        : `${items.length}\0${String(itemKeyForIndex(0))}\0${String(
            itemKeyForIndex(items.length - 1),
          )}`;
    const edgeChanged = nextEdgeSignature !== itemEdgeSignature;
    itemEdgeSignature = nextEdgeSignature;

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
    if (!shouldFollowEnd()) {
      cancelFollowFrame();
      followSettleFrames = 0;
    } else if (edgeChanged) {
      scheduleFollowToEnd();
    }
  });

  // Raw scroll events update `atEnd` with sub-range precision (the virtualizer
  // only notifies on range changes, not every scrolled pixel).
  function handleScroll() {
    atEnd = instance.isAtEnd(scrollEndThreshold);
  }

  $effect(() => {
    void viewportEl;
    controller = {
      scrollToEnd: (opts) => instance.scrollToEnd(opts),
      scrollToIndex: (index, opts) => instance.scrollToIndex(index, opts),
      isAtEnd: (threshold) => instance.isAtEnd(threshold ?? scrollEndThreshold),
      getDistanceFromEnd: () => instance.getDistanceFromEnd(),
      getViewportElement: () => viewportEl,
      measureAll: () => instance.measure(),
    } satisfies VirtualScrollerController;
  });

  // Batched measurement: bursty row mounts (tab switch, conversation open) used
  // to interleave layout reads (`offsetHeight`) with writes (`resizeItem`),
  // forcing one reflow per row. Instead, collect nodes for one frame, READ all
  // heights first, then WRITE all sizes — a single reflow per frame.
  const pendingMeasure = new Map<number, HTMLElement>();
  let measureFrame: number | undefined;

  function flushMeasurements() {
    measureFrame = undefined;
    if (pendingMeasure.size === 0) return;
    // Phase 1: read every height before mutating anything.
    const heights: Array<[number, number]> = [];
    for (const [index, node] of pendingMeasure) {
      heights.push([index, node.offsetHeight]);
    }
    pendingMeasure.clear();
    // Phase 2: apply sizes. `resizeItem` keeps virtual-core's scroll-anchor
    // logic intact; batching just removes the read/write interleaving.
    const cache = heightCache;
    for (const [index, height] of heights) {
      instance.resizeItem(index, height);
      cache?.set(itemKeyForIndex(index), height);
    }
    scheduleFollowToEnd(3);
  }

  function queueMeasure(node: HTMLElement) {
    // Register the node for future resizes (async highlight, image/font load,
    // re-wrapping). The internal ResizeObserver also fires once on observe.
    instance.measureElement(node);
    const index = Number(node.dataset.index);
    if (!Number.isNaN(index)) pendingMeasure.set(index, node);
    if (measureFrame === undefined) {
      measureFrame = requestAnimationFrame(flushMeasurements);
    }
  }

  function cancelMeasureFrame() {
    if (measureFrame === undefined) return;
    cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
  }

  function measure(node: HTMLElement) {
    let lastHeight = node.offsetHeight;
    let observer: ResizeObserver | undefined;

    queueMeasure(node);

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        const nextHeight = node.offsetHeight;
        if (nextHeight === lastHeight) return;
        lastHeight = nextHeight;
        queueMeasure(node);
      });
      observer.observe(node);
    }

    return {
      update() {
        queueMeasure(node);
      },
      destroy() {
        observer?.disconnect();
        const index = Number(node.dataset.index);
        if (!Number.isNaN(index)) pendingMeasure.delete(index);
        if (pendingMeasure.size === 0) cancelMeasureFrame();
        queueMicrotask(() => instance.measureElement(null));
      },
    };
  }

  $effect(() => {
    return () => {
      cancelFollowFrame();
      cancelMeasureFrame();
    };
  });
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
    {#each renderedVirtualItems as virtualRow (virtualRow.key)}
      {@const item = items[virtualRow.index]}
      {#if item !== undefined}
        <div
          class="virtual-scroller-row"
          data-index={virtualRow.index}
          use:measure
          style:transform={`translateY(${virtualRow.start}px)`}
        >
          {@render row({ item, index: virtualRow.index })}
        </div>
      {/if}
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
