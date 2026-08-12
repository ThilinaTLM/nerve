<script lang="ts">
import { tick, type Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import { relativeItemRectangle } from "./item-collection.js";

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
let measureFrame: number | undefined;
let showFrame: number | undefined;

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

function measure(): void {
  measureFrame = undefined;
  if (!collection) return;
  const target = activeTarget();
  if (!target) {
    visible = false;
    return;
  }

  const geometry = relativeItemRectangle(
    collection.getBoundingClientRect(),
    target.getBoundingClientRect(),
  );
  x = geometry.x;
  y = geometry.y;
  width = geometry.width;
  height = geometry.height;

  if (!visible) {
    if (showFrame !== undefined) cancelAnimationFrame(showFrame);
    showFrame = requestAnimationFrame(() => {
      showFrame = undefined;
      if (activeTarget()) visible = true;
    });
  }
}

function scheduleMeasure(): void {
  if (measureFrame !== undefined) return;
  measureFrame = requestAnimationFrame(measure);
}

$effect(() => {
  const key = activeKey;
  const host = collection;
  void tick().then(() => {
    if (activeKey === key && collection === host) scheduleMeasure();
  });
});

$effect(() => {
  const host = collection;
  if (!host) return;

  const resizeObserver = new ResizeObserver(scheduleMeasure);
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

  host.addEventListener("scroll", scheduleMeasure, true);
  window.addEventListener("resize", scheduleMeasure);
  scheduleMeasure();

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    host.removeEventListener("scroll", scheduleMeasure, true);
    window.removeEventListener("resize", scheduleMeasure);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    if (showFrame !== undefined) cancelAnimationFrame(showFrame);
    measureFrame = undefined;
    showFrame = undefined;
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
    aria-hidden="true"
    class="pointer-events-none absolute top-0 left-0 z-20 rounded-md border border-primary opacity-0 transition-[transform,width,height,opacity] duration-200 ease-out will-change-transform"
    class:opacity-100={visible}
    style:transform={`translate3d(${x}px, ${y}px, 0)`}
    style:width={`${width}px`}
    style:height={`${height}px`}
  ></div>
</div>
