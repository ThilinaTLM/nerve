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
import {
  FloatingLayer,
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarGroup,
  FloatingToolbarText,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
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
  /** Short readout in the top-start corner, e.g. pixel dimensions. */
  info?: string;
  copyLabel?: string;
  onCopy?: () => void;
  downloadLabel?: string;
  onDownload?: () => void;
  openLabel?: string;
  onOpenStandalone?: () => void;
  /** `FloatingNotice`s in the bottom-start corner (unsaved changes, truncated source). */
  notices?: Snippet;
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
  notices,
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
// The zoom level shows in a pill beside the zoom bar while the user zooms
// (and briefly after), and while the bar is hovered or focused.
let zoomChanging = $state(false);
let zoomControlsActive = $state(false);
let zoomChangingTimer: ReturnType<typeof setTimeout> | undefined;

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

function announceZoom(): void {
  zoomChanging = true;
  clearTimeout(zoomChangingTimer);
  zoomChangingTimer = setTimeout(() => (zoomChanging = false), 1200);
}

function userFit(): void {
  fit();
  announceZoom();
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
  announceZoom();
}

function zoomAt(nextScale: number, clientX?: number, clientY?: number): void {
  if (!viewport || !hasContent) return;
  const bounds = viewport.getBoundingClientRect();
  view = zoomTransform(view, nextScale, {
    x: clientX === undefined ? bounds.width / 2 : clientX - bounds.left,
    y: clientY === undefined ? bounds.height / 2 : clientY - bounds.top,
  });
  automaticFit = false;
  announceZoom();
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
  else userFit();
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
    "0": userFit,
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

$effect(() => () => clearTimeout(zoomChangingTimer));
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
    <FloatingLayer {topStart} {topEnd} {bottomStart} {bottomEnd} />
  {/if}
</div>

<!-- Canvas layout shared by every pan/zoom view: what it is (top start),
     what you can do with it (top end), where you are on it (bottom end),
     notices (bottom start). -->
{#snippet topStart()}
  {#if info}
    <FloatingToolbar label={`${ariaLabel} details`}>
      <FloatingToolbarGroup collapse>
        <FloatingToolbarText>{info}</FloatingToolbarText>
      </FloatingToolbarGroup>
    </FloatingToolbar>
  {/if}
{/snippet}

{#snippet topEnd()}
  <FloatingToolbar label={`${ariaLabel} actions`}>
    {#if transparencyToggle}
      <FloatingToolbarGroup>
        <FloatingToolbarButton
          label="Show transparency"
          icon={Grid2x2}
          pressed={checkerboard}
          onclick={() => (checkerboard = !checkerboard)}
        />
      </FloatingToolbarGroup>
    {/if}
    <FloatingToolbarGroup>
      {#if onCopy}
        <FloatingToolbarButton label={copyLabel} icon={Copy} onclick={onCopy} />
      {/if}
      {#if onDownload}
        <FloatingToolbarButton
          label={downloadLabel}
          icon={Download}
          onclick={onDownload}
        />
      {/if}
      <FloatingToolbarButton
        label={fullscreen ? "Exit full screen" : "Full screen"}
        shortcut="F"
        icon={fullscreen ? Minimize2 : Maximize2}
        onclick={() => void toggleFullscreen()}
      />
      {#if onOpenStandalone}
        <FloatingToolbarButton
          label={openLabel}
          icon={ExternalLink}
          onclick={onOpenStandalone}
        />
      {/if}
    </FloatingToolbarGroup>
  </FloatingToolbar>
{/snippet}

{#snippet bottomStart()}
  {@render notices?.()}
{/snippet}

{#snippet bottomEnd()}
  <!-- The zoom level sits in its own pill so a changing value never resizes
       the icon-only bar; the pill resets to actual size. -->
  <div
    class="flex items-start gap-1.5"
    role="presentation"
    onpointerenter={() => (zoomControlsActive = true)}
    onpointerleave={() => (zoomControlsActive = false)}
    onfocusin={() => (zoomControlsActive = true)}
    onfocusout={() => (zoomControlsActive = false)}
  >
    {#if zoomChanging || zoomControlsActive}
      <FloatingToolbar label="Zoom level">
        <FloatingToolbarButton
          label="Actual size"
          shortcut="1"
          text={zoomLabel}
          onclick={actualSize}
        />
      </FloatingToolbar>
    {/if}
    <FloatingToolbar label="Zoom" orientation="vertical">
      <FloatingToolbarGroup>
        <FloatingToolbarButton
          label="Zoom in"
          shortcut="+"
          icon={ZoomIn}
          disabled={view.scale >= MAX_SCALE}
          onclick={() => zoomAt(view.scale * ZOOM_STEP)}
        />
        <FloatingToolbarButton
          label="Zoom out"
          shortcut="-"
          icon={ZoomOut}
          disabled={view.scale <= MIN_SCALE}
          onclick={() => zoomAt(view.scale / ZOOM_STEP)}
        />
      </FloatingToolbarGroup>
      <FloatingToolbarGroup>
        <FloatingToolbarButton
          label="Fit to view"
          shortcut="0"
          icon={Scan}
          pressed={automaticFit}
          onclick={userFit}
        />
        <FloatingToolbarButton
          label="Mouse wheel zoom (Ctrl+wheel always zooms)"
          icon={Mouse}
          pressed={wheelZoomEnabled}
          onclick={() => (wheelZoomEnabled = !wheelZoomEnabled)}
        />
      </FloatingToolbarGroup>
    </FloatingToolbar>
  </div>
{/snippet}
