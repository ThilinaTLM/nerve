<script lang="ts">
import { tick, type Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import {
  relativeItemRectangle,
  type RelativeItemRectangle,
} from "./item-collection.js";

let {
  activeKey,
  class: className,
  children,
}: {
  activeKey?: string;
  class?: string;
  children: Snippet;
} = $props();

let collection = $state<HTMLDivElement>();
let x = $state(0);
let y = $state(0);
let width = $state(0);
let height = $state(0);
let visible = $state(false);

/** Outline glides between items; everything else snaps to avoid clip lag. */
const MOVE_DURATION_MS = 200;
let measureFrame: number | undefined;
let showFrame: number | undefined;
let animateMeasure = false;
let requestedKey: string | undefined;
let overlay = $state<HTMLDivElement>();

/** Cancel geometry animations before snapping to a layout measurement. */
function cancelOverlayAnimation(): void {
  if (!overlay) return;
  for (const animation of overlay.getAnimations()) animation.cancel();
}

/** Re-measures from resize/scroll/layout must snap; only item moves glide. */
function applyGeometry(
  geometry: RelativeItemRectangle,
  animate: boolean,
): void {
  if (!animate) cancelOverlayAnimation();

  if (
    animate &&
    overlay &&
    visible &&
    (geometry.x !== x ||
      geometry.y !== y ||
      geometry.width !== width ||
      geometry.height !== height)
  ) {
    // Read the current interpolated frame first so rapid retargets stay smooth.
    const computed = getComputedStyle(overlay);
    const from = {
      transform: computed.transform,
      width: computed.width,
      height: computed.height,
    };
    cancelOverlayAnimation();
    overlay.animate([from, toKeyframe(geometry)], {
      duration: MOVE_DURATION_MS,
      easing: "ease-out",
    });
  }
  x = geometry.x;
  y = geometry.y;
  width = geometry.width;
  height = geometry.height;
}

function toKeyframe(geometry: RelativeItemRectangle): {
  transform: string;
  width: string;
  height: string;
} {
  return {
    transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
  };
}

function candidates(): HTMLElement[] {
  if (!collection) return [];
  return [
    ...collection.querySelectorAll<HTMLElement>("[data-active-outline-key]"),
  ].filter(
    (candidate) =>
      candidate.closest<HTMLElement>("[data-item-collection]") === collection,
  );
}

function activeTarget(): HTMLElement | undefined {
  if (!activeKey) return undefined;
  return candidates().find(
    (candidate) => candidate.dataset.activeOutlineKey === activeKey,
  );
}

function measure(animate: boolean): void {
  if (!collection) return;
  const target = activeTarget();
  if (!target) {
    visible = false;
    return;
  }

  const geometry = relativeItemRectangle(
    collection.getBoundingClientRect(),
    target.getBoundingClientRect(),
    window.devicePixelRatio || 1,
  );
  applyGeometry(geometry, animate);

  if (!visible) {
    if (showFrame !== undefined) cancelAnimationFrame(showFrame);
    showFrame = requestAnimationFrame(() => {
      showFrame = undefined;
      if (activeTarget()) visible = true;
    });
  }
}

function scheduleMeasure(animate = false): void {
  // DOM observer/event callbacks pass their event payload as the first
  // argument; only the explicit boolean from the active-key effect animates.
  if (animate === true) animateMeasure = true;
  if (measureFrame !== undefined) return;
  measureFrame = requestAnimationFrame(() => {
    measureFrame = undefined;
    const shouldAnimate = animateMeasure;
    animateMeasure = false;
    measure(shouldAnimate);
  });
}

$effect(() => {
  const key = activeKey;
  const host = collection;
  const animate =
    key !== undefined && requestedKey !== undefined && key !== requestedKey;
  requestedKey = key;
  void tick().then(() => {
    if (activeKey === key && collection === host) scheduleMeasure(animate);
  });
});

$effect(() => {
  const host = collection;
  if (!host) return;

  const scheduleLayoutMeasure = () => scheduleMeasure();
  const resizeObserver = new ResizeObserver(scheduleLayoutMeasure);
  const observeCandidates = () => {
    resizeObserver.disconnect();
    resizeObserver.observe(host);
    for (const candidate of candidates()) resizeObserver.observe(candidate);
  };
  observeCandidates();

  const mutationObserver = new MutationObserver(() => {
    observeCandidates();
    scheduleMeasure();
  });
  mutationObserver.observe(host, { childList: true, subtree: true });

  host.addEventListener("scroll", scheduleLayoutMeasure, true);
  window.addEventListener("resize", scheduleLayoutMeasure);
  scheduleMeasure();

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    host.removeEventListener("scroll", scheduleLayoutMeasure, true);
    window.removeEventListener("resize", scheduleLayoutMeasure);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    if (showFrame !== undefined) cancelAnimationFrame(showFrame);
    cancelOverlayAnimation();
    measureFrame = undefined;
    showFrame = undefined;
    animateMeasure = false;
  };
});
</script>

<div
  bind:this={collection}
  data-item-collection=""
  class={cn("relative min-w-0", className)}
>
  {@render children()}
  <div
    bind:this={overlay}
    aria-hidden="true"
    class="pointer-events-none absolute top-0 left-0 z-20 rounded-md border border-primary/60 opacity-0 transition-[opacity] duration-200 ease-out will-change-transform"
    class:opacity-100={visible}
    style:transform={`translate3d(${x}px, ${y}px, 0)`}
    style:width={`${width}px`}
    style:height={`${height}px`}
  ></div>
</div>
