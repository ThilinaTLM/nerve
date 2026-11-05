<script lang="ts">
import { untrack, type Snippet } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import ExternalLink from "@lucide/svelte/icons/external-link";
import Grid2x2 from "@lucide/svelte/icons/grid-2x2";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Minimize2 from "@lucide/svelte/icons/minimize-2";
import Mouse from "@lucide/svelte/icons/mouse";
import Scan from "@lucide/svelte/icons/scan";
import ZoomIn from "@lucide/svelte/icons/zoom-in";
import ZoomOut from "@lucide/svelte/icons/zoom-out";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { FloatingToolbar } from "@nervekit/ui-kit/components/composites/floating-toolbar";
import {
  centeredTransform,
  fitTransform,
  MAX_SCALE,
  MIN_SCALE,
  type PanZoomTransform,
  ZOOM_STEP,
  zoomTransform,
} from "./pan-zoom.js";

type Props = {
  /** Natural content size in CSS pixels; 0 while loading. */
  contentWidth: number;
  contentHeight: number;
  ariaLabel: string;
  class?: string;
  /** Shows the toolbar and enables gestures. */
  ready?: boolean;
  fitPadding?: number;
  /** Upper bound for "fit"; images use 1 so small ones aren't upscaled. */
  maxFitScale?: number;
  defaultWheelZoomEnabled?: boolean;
  /** Offers a transparency checkerboard toggle (raster images, SVG). */
  transparencyToggle?: boolean;
  /** Short muted text in the toolbar, e.g. pixel dimensions. */
  info?: string;
  copyLabel?: string;
  onCopy?: () => void;
  downloadLabel?: string;
  onDownload?: () => void;
  openLabel?: string;
  onOpenStandalone?: () => void;
  /** Extra leading toolbar controls. */
  toolbarStart?: Snippet;
  /** Loading or error states drawn over the viewport. */
  overlay?: Snippet;
  /** The content, rendered at its natural size. */
  children: Snippet;
};

let {
  contentWidth,
  contentHeight,
  ariaLabel,
  class: className = "",
  ready = true,
  fitPadding = 32,
  maxFitScale = MAX_SCALE,
  defaultWheelZoomEnabled = false,
  transparencyToggle = false,
  info,
  copyLabel = "Copy",
  onCopy,
  downloadLabel = "Download",
  onDownload,
  openLabel = "Open in tab",
  onOpenStandalone,
  toolbarStart,
  overlay,
  children,
}: Props = $props();

let root = $state<HTMLElement | null>(null);
let viewport = $state<HTMLElement | null>(null);
let view = $state<PanZoomTransform>({ scale: 1, x: 0, y: 0 });
let automaticFit = $state(true);
let wheelZoomEnabled = $state(untrack(() => defaultWheelZoomEnabled));
let checkerboard = $state(false);
let fullscreen = $state(false);
let dragging = $state(false);
let activePointerId: number | undefined;
let dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

const hasContent = $derived(ready && contentWidth > 0 && contentHeight > 0);
const transform = $derived(
  `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
);
const zoomLabel = $derived(`${Math.round(view.scale * 100)}%`);
const checkerboardStyle =
  "background-image: conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0); background-size: 16px 16px;";

function viewportSize() {
  return {
    width: viewport?.clientWidth ?? 0,
    height: viewport?.clientHeight ?? 0,
  };
}

function content() {
  return { width: contentWidth, height: contentHeight };
}

export function fit(): void {
  if (!viewport || !hasContent) return;
  view = fitTransform(viewportSize(), content(), fitPadding, maxFitScale);
  automaticFit = true;
}

export function actualSize(): void {
  if (!viewport || !hasContent) return;
  view = centeredTransform(viewportSize(), content(), 1);
  automaticFit = false;
}

function zoomAt(nextScale: number, clientX?: number, clientY?: number): void {
  if (!viewport || !hasContent) return;
  const bounds = viewport.getBoundingClientRect();
  view = zoomTransform(view, nextScale, {
    x: clientX === undefined ? bounds.width / 2 : clientX - bounds.left,
    y: clientY === undefined ? bounds.height / 2 : clientY - bounds.top,
  });
  automaticFit = false;
}

function handleWheel(event: WheelEvent): void {
  if (!hasContent || (!wheelZoomEnabled && !event.ctrlKey)) return;
  event.preventDefault();
  zoomAt(
    view.scale * Math.exp(-event.deltaY * 0.001),
    event.clientX,
    event.clientY,
  );
}

function startPan(event: PointerEvent): void {
  if (!hasContent || (event.pointerType === "mouse" && event.button !== 0))
    return;
  activePointerId = event.pointerId;
  dragging = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    offsetX: view.x,
    offsetY: view.y,
  };
  viewport?.setPointerCapture(event.pointerId);
}

function movePan(event: PointerEvent): void {
  if (!dragging || event.pointerId !== activePointerId) return;
  automaticFit = false;
  view = {
    scale: view.scale,
    x: dragStart.offsetX + event.clientX - dragStart.x,
    y: dragStart.offsetY + event.clientY - dragStart.y,
  };
}

function endPan(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  dragging = false;
  activePointerId = undefined;
  if (viewport?.hasPointerCapture(event.pointerId))
    viewport.releasePointerCapture(event.pointerId);
}

function toggleFitActual(): void {
  if (automaticFit) actualSize();
  else fit();
}

async function toggleFullscreen(): Promise<void> {
  if (!root) return;
  if (document.fullscreenElement === root) await document.exitFullscreen();
  else await root.requestFullscreen?.();
}

function handleKeydown(event: KeyboardEvent): void {
  if (!hasContent || event.ctrlKey || event.metaKey || event.altKey) return;
  const actions: Record<string, () => void> = {
    "+": () => zoomAt(view.scale * ZOOM_STEP),
    "=": () => zoomAt(view.scale * ZOOM_STEP),
    "-": () => zoomAt(view.scale / ZOOM_STEP),
    "0": fit,
    "1": actualSize,
    f: () => void toggleFullscreen(),
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
}

// Refit when new content arrives (or its size changes) while fitting.
$effect(() => {
  void contentWidth;
  void contentHeight;
  void hasContent;
  if (untrack(() => automaticFit)) requestAnimationFrame(fit);
});

$effect(() => {
  if (!viewport) return;
  const observer = new ResizeObserver(() => {
    if (automaticFit) fit();
  });
  observer.observe(viewport);
  return () => observer.disconnect();
});

$effect(() => {
  const update = () => {
    fullscreen = Boolean(root) && document.fullscreenElement === root;
  };
  document.addEventListener("fullscreenchange", update);
  return () => document.removeEventListener("fullscreenchange", update);
});
</script>

<!-- Keyboard zoom shortcuts apply while focus is anywhere in the view. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={root}
  class={`relative min-h-0 min-w-0 overflow-hidden bg-background outline-none ${className}`}
  role="region"
  aria-label={ariaLabel}
  tabindex="-1"
  onkeydown={handleKeydown}
>
  <div
    bind:this={viewport}
    class={`absolute inset-0 touch-none ${hasContent ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
    style={checkerboard ? checkerboardStyle : undefined}
    role="presentation"
    onwheel={handleWheel}
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={endPan}
    onpointercancel={endPan}
    ondblclick={toggleFitActual}
  >
    <div
      class="absolute top-0 left-0 origin-top-left touch-none select-none"
      style:transform
    >
      {@render children()}
    </div>
  </div>

  {@render overlay?.()}

  {#if hasContent}
    <FloatingToolbar label={`${ariaLabel} controls`} isolatePointer>
      {@render toolbarStart?.()}
      {#if info}
        <span class="px-1.5 text-ui text-muted-foreground tabular-nums"
          >{info}</span
        >
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        pressed={wheelZoomEnabled}
        active={wheelZoomEnabled}
        ariaLabel={wheelZoomEnabled
          ? "Disable mouse wheel zoom"
          : "Enable mouse wheel zoom; hold Control for temporary zoom"}
        title={wheelZoomEnabled
          ? "Disable mouse wheel zoom"
          : "Enable mouse wheel zoom (Ctrl+wheel temporarily)"}
        onclick={() => (wheelZoomEnabled = !wheelZoomEnabled)}
      >
        <Mouse class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Zoom out"
        title="Zoom out (−)"
        disabled={view.scale <= MIN_SCALE}
        onclick={() => zoomAt(view.scale / ZOOM_STEP)}
      >
        <ZoomOut class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="min-w-12 tabular-nums"
        ariaLabel={`Zoom ${zoomLabel}; show actual size`}
        title="Actual size (1)"
        onclick={actualSize}
      >
        {zoomLabel}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Zoom in"
        title="Zoom in (+)"
        disabled={view.scale >= MAX_SCALE}
        onclick={() => zoomAt(view.scale * ZOOM_STEP)}
      >
        <ZoomIn class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Fit to view"
        title="Fit to view (0)"
        pressed={automaticFit}
        onclick={fit}
      >
        <Scan class="size-3" />
      </Button>
      <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
      {#if transparencyToggle}
        <Button
          variant="ghost"
          size="icon-sm"
          pressed={checkerboard}
          active={checkerboard}
          ariaLabel="Show transparency"
          title="Show transparency"
          onclick={() => (checkerboard = !checkerboard)}
        >
          <Grid2x2 class="size-3" />
        </Button>
      {/if}
      {#if onCopy}
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel={copyLabel}
          title={copyLabel}
          onclick={onCopy}
        >
          <Copy class="size-3" />
        </Button>
      {/if}
      {#if onDownload}
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel={downloadLabel}
          title={downloadLabel}
          onclick={onDownload}
        >
          <Download class="size-3" />
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={fullscreen ? "Exit full screen" : "Full screen"}
        title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
        onclick={() => void toggleFullscreen()}
      >
        {#if fullscreen}
          <Minimize2 class="size-3" />
        {:else}
          <Maximize2 class="size-3" />
        {/if}
      </Button>
      {#if onOpenStandalone}
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel={openLabel}
          title={openLabel}
          onclick={onOpenStandalone}
        >
          <ExternalLink class="size-3" />
        </Button>
      {/if}
    </FloatingToolbar>
  {/if}
</div>
