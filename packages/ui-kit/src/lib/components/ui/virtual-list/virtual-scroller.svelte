<script lang="ts" generics="T">
import { createVirtualizer } from "@tanstack/svelte-virtual";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { get } from "svelte/store";
import { cn } from "@nervekit/ui-kit/core/utils";
import { getRowHeightCache } from "./row-height-cache";
import {
  captureItemKeySnapshot,
  createItemKeyAccessor,
  deriveVirtualDomIdentities,
  itemKeySnapshotsEqual,
  measurementTargetIsCurrent,
  type VirtualScrollerItemKey,
} from "./virtual-scroller-identity";
import type {
  VirtualScrollBehavior,
  VirtualScrollerController,
  VirtualScrollerProps,
} from "./virtual-scroller-types";
import { shouldCommitVirtualMeasurement } from "./virtual-measurement";

/* eslint-disable no-useless-assignment -- $bindable defaults declare parent bindings before later reactive updates. */
let {
  items,
  getKey,
  estimateSize,
  heightCacheKey,
  getMeasurementVersion,
  contentVisibility = false,
  overscan = 8,
  anchor = "start",
  followOutput = false,
  scrollEndThreshold,
  paddingStart = 0,
  paddingEnd = 0,
  gap,
  controller = $bindable(),
  atEnd = $bindable(true),
  viewportTabIndex,
  viewportAriaLabel,
  viewportClass,
  class: className,
  row,
}: VirtualScrollerProps<T> = $props();
/* eslint-enable no-useless-assignment */

let viewportEl = $state<HTMLDivElement | null>(null);

const DEFAULT_ESTIMATE = 64;

// Persisted per-scope height cache (seeded into `estimateSize` so remounts
// paint at real height without a synchronous reflow). Resolved reactively in
// case the scope key changes for a live instance.
const heightCache = $derived(
  heightCacheKey ? getRowHeightCache(heightCacheKey) : undefined,
);
const committedMeasurementHeights = new SvelteMap<
  VirtualScrollerItemKey,
  number
>();
let committedMeasurementScope: string | undefined;
$effect(() => {
  const scope = heightCacheKey;
  if (scope === committedMeasurementScope) return;
  committedMeasurementScope = scope;
  committedMeasurementHeights.clear();
});

let itemKeySnapshot: readonly VirtualScrollerItemKey[] = Object.freeze([]);

function resolveEstimate(index: number): number {
  const key = itemKeySnapshot[index];
  const cached = key === undefined ? undefined : heightCache?.get(key);
  if (cached !== undefined) return cached;
  return estimateSize?.(index) ?? DEFAULT_ESTIMATE;
}

// Created once per component instance. Structural reconciliation replaces the
// immutable key accessor whenever any key in the sequence changes.
const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
  count: 0,
  getScrollElement: () => viewportEl,
  estimateSize: (index) => resolveEstimate(index),
  getItemKey: createItemKeyAccessor(itemKeySnapshot),
});

// Stable instance reference (also ensures the adapter has attached its wrapped
// `setOptions`). The adapter mutates and re-emits this SAME object on every
// change, so Svelte's store->rune bridge can't detect updates by identity.
// We therefore mirror the bits the template needs into plain `$state`, written
// from the subscription callback below.
const instance = get(virtualizer);

let virtualItems = $state(instance.getVirtualItems());
let totalSize = $state(instance.getTotalSize());
const renderedVirtualRows = $derived.by(() => {
  const inRange = virtualItems.filter(
    (virtualRow) => virtualRow.index >= 0 && virtualRow.index < items.length,
  );
  const identities = deriveVirtualDomIdentities(
    inRange.map((virtualRow) => virtualRow.key as VirtualScrollerItemKey),
  );
  return inRange.map((virtualRow, index) => ({
    virtualRow,
    ...identities[index],
  }));
});

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

// Reconcile dynamic options without recreating the virtualizer (preserves
// scroll/measurement state). Touching `viewportEl` re-runs this once the
// scroll element binds so `_willUpdate` can attach scroll listeners.
$effect(() => {
  void viewportEl;
  const nextKeySnapshot = captureItemKeySnapshot(items, getKey);
  const structuralKeysChanged = !itemKeySnapshotsEqual(
    itemKeySnapshot,
    nextKeySnapshot,
  );
  // End-follow is deliberately independent of full structural detection: an
  // interior draft-to-tool replacement must refresh identity without pulling
  // a manually scrolled viewport back to the tail.
  const endChanged =
    nextKeySnapshot.length !== itemKeySnapshot.length ||
    !Object.is(nextKeySnapshot.at(-1), itemKeySnapshot.at(-1));
  itemKeySnapshot = nextKeySnapshot;

  instance.setOptions({
    count: items.length,
    overscan,
    anchorTo: anchor,
    followOnAppend: followOutput,
    paddingStart,
    paddingEnd,
    ...(structuralKeysChanged
      ? { getItemKey: createItemKeyAccessor(nextKeySnapshot) }
      : {}),
    ...(scrollEndThreshold !== undefined ? { scrollEndThreshold } : {}),
    ...(gap !== undefined ? { gap } : {}),
  });
  syncFromVirtualizer();
  if (!shouldFollowEnd()) {
    cancelFollowFrame();
    followSettleFrames = 0;
  } else if (endChanged) {
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
    measureAll: enqueueAllMeasurements,
  } satisfies VirtualScrollerController;
});

// Every mount, ResizeObserver notification, explicit revision, and imperative
// measure request enters this one node-keyed batch. Numeric indexes are read
// only at flush time and validated against the current immutable key snapshot.
const registeredMeasureNodes = new SvelteSet<HTMLElement>();
const pendingMeasureNodes = new SvelteSet<HTMLElement>();
let measureFrame: number | undefined;
let resizeObserver: ResizeObserver | undefined;

function sharedResizeObserver(): ResizeObserver | undefined {
  if (resizeObserver || typeof ResizeObserver === "undefined")
    return resizeObserver;
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) queueMeasure(entry.target as HTMLElement);
  });
  return resizeObserver;
}

function measurableHeight(node: HTMLElement): number | undefined {
  // Kept-mounted panes use display:none while inactive. Never let a hidden
  // zero overwrite either TanStack geometry or the persisted height cache.
  if (!node.isConnected || node.getClientRects().length === 0) return undefined;
  return node.offsetHeight;
}

function flushMeasurements() {
  measureFrame = undefined;
  if (pendingMeasureNodes.size === 0) return;

  // Phase 1: validate identity and read all heights before any virtualizer
  // write can trigger layout/scroll reconciliation.
  const measurements: Array<{
    index: number;
    key: VirtualScrollerItemKey;
    height: number;
  }> = [];
  for (const node of pendingMeasureNodes) {
    if (
      !registeredMeasureNodes.has(node) ||
      !measurementTargetIsCurrent(
        itemKeySnapshot,
        node.dataset.index,
        node.dataset.itemKey,
      )
    ) {
      continue;
    }
    const height = measurableHeight(node);
    const index = Number(node.dataset.index);
    const key = itemKeySnapshot[index];
    if (height !== undefined && key !== undefined) {
      measurements.push({ index, key, height });
    }
  }
  pendingMeasureNodes.clear();

  // Phase 2: resize only the index/key pairs proven current above.
  const cache = heightCache;
  let committedCount = 0;
  for (const { index, key, height } of measurements) {
    const previousHeight =
      committedMeasurementHeights.get(key) ?? cache?.get(key);
    if (!shouldCommitVirtualMeasurement(previousHeight, height)) {
      committedMeasurementHeights.set(key, height);
      continue;
    }
    instance.resizeItem(index, height);
    cache?.set(key, height);
    committedMeasurementHeights.set(key, height);
    committedCount += 1;
  }
  if (committedCount > 0) scheduleFollowToEnd(3);
}

function queueMeasure(node: HTMLElement) {
  if (!registeredMeasureNodes.has(node)) return;
  pendingMeasureNodes.add(node);
  if (measureFrame === undefined) {
    measureFrame = requestAnimationFrame(flushMeasurements);
  }
}

function enqueueAllMeasurements() {
  for (const node of registeredMeasureNodes) queueMeasure(node);
}

function cancelMeasureFrame() {
  if (measureFrame === undefined) return;
  cancelAnimationFrame(measureFrame);
  measureFrame = undefined;
}

function measure(node: HTMLElement, measurementVersion: unknown) {
  let currentMeasurementVersion = measurementVersion;
  registeredMeasureNodes.add(node);
  sharedResizeObserver()?.observe(node);
  queueMeasure(node);

  return {
    update(nextMeasurementVersion: unknown) {
      if (Object.is(nextMeasurementVersion, currentMeasurementVersion)) return;
      currentMeasurementVersion = nextMeasurementVersion;
      queueMeasure(node);
    },
    destroy() {
      resizeObserver?.unobserve(node);
      registeredMeasureNodes.delete(node);
      pendingMeasureNodes.delete(node);
      if (pendingMeasureNodes.size === 0) cancelMeasureFrame();
    },
  };
}

$effect(() => {
  return () => {
    cancelFollowFrame();
    cancelMeasureFrame();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    registeredMeasureNodes.clear();
    pendingMeasureNodes.clear();
    committedMeasurementHeights.clear();
  };
});
</script>

<!-- A labelled region is intentionally focusable so native keyboard scrolling
     reaches the actual viewport rather than its non-scrolling wrapper. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={viewportEl}
  class={cn("virtual-scroller-viewport", viewportClass)}
  role={viewportAriaLabel ? "region" : undefined}
  tabindex={viewportTabIndex}
  aria-label={viewportAriaLabel}
  onscroll={handleScroll}
>
  <div
    class={cn("virtual-scroller-spacer", className)}
    style:height={`${totalSize}px`}
  >
    {#each renderedVirtualRows as rendered (rendered.domKey)}
      {@const virtualRow = rendered.virtualRow}
      {@const item = items[virtualRow.index]}
      {#if item !== undefined}
        <div
          class="virtual-scroller-row"
          class:cv-auto={contentVisibility}
          data-index={virtualRow.index}
          data-item-key={rendered.encodedItemKey}
          use:measure={getMeasurementVersion?.(item, virtualRow.index)}
          style:transform={`translateY(${virtualRow.start}px)`}
          style:contain-intrinsic-size={contentVisibility
            ? `auto ${Math.max(1, Math.round(virtualRow.size))}px`
            : undefined}
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

/* Skip layout/paint for off-screen rows. `contain-intrinsic-size` (set inline
     from the virtualizer's known height) keeps skipped rows reporting an
     accurate height so measurement and scroll math stay correct. */
.virtual-scroller-row.cv-auto {
  content-visibility: auto;
}
</style>
