<script lang="ts">
import { untrack } from "svelte";
import ExternalLink from "@lucide/svelte/icons/external-link";
import Maximize from "@lucide/svelte/icons/maximize";
import Mouse from "@lucide/svelte/icons/mouse";
import ZoomIn from "@lucide/svelte/icons/zoom-in";
import ZoomOut from "@lucide/svelte/icons/zoom-out";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { mountMermaidSvg, renderMermaid } from "./mermaid-render.js";

type Props = {
  source: string;
  ariaLabel?: string;
  class?: string;
  defaultWheelZoomEnabled?: boolean;
  onOpenStandalone?: () => void;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 32;

let {
  source,
  ariaLabel = "Mermaid diagram",
  class: className = "",
  defaultWheelZoomEnabled = false,
  onOpenStandalone,
}: Props = $props();

let viewport = $state<HTMLElement | null>(null);
let host = $state<HTMLElement | null>(null);
let renderState = $state<"loading" | "rendered" | "error">("loading");
let scale = $state(1);
let offsetX = $state(0);
let offsetY = $state(0);
let diagramWidth = $state(0);
let diagramHeight = $state(0);
let automaticFit = $state(true);
let wheelZoomEnabled = $state(untrack(() => defaultWheelZoomEnabled));
let dragging = $state(false);
let activePointerId: number | undefined;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let generation = 0;

const transform = $derived(
  `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
);

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function prepareDiagram(target: HTMLElement): boolean {
  const svg = target.querySelector<SVGSVGElement>("svg");
  const viewBox = svg?.viewBox.baseVal;
  if (!svg || !viewBox || viewBox.width <= 0 || viewBox.height <= 0)
    return false;
  diagramWidth = viewBox.width;
  diagramHeight = viewBox.height;
  target.style.width = `${diagramWidth}px`;
  target.style.height = `${diagramHeight}px`;
  svg.style.width = `${diagramWidth}px`;
  svg.style.height = `${diagramHeight}px`;
  svg.style.maxWidth = "none";
  return true;
}

function fitDiagram() {
  if (!viewport || diagramWidth <= 0 || diagramHeight <= 0) return;
  const availableWidth = Math.max(1, viewport.clientWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.clientHeight - FIT_PADDING * 2);
  scale = clampScale(
    Math.min(availableWidth / diagramWidth, availableHeight / diagramHeight),
  );
  offsetX = (viewport.clientWidth - diagramWidth * scale) / 2;
  offsetY = (viewport.clientHeight - diagramHeight * scale) / 2;
  automaticFit = true;
}

function zoomAt(nextScale: number, clientX?: number, clientY?: number) {
  if (!viewport || diagramWidth <= 0 || diagramHeight <= 0) return;
  const next = clampScale(nextScale);
  if (next === scale) return;
  const bounds = viewport.getBoundingClientRect();
  const pointX =
    clientX === undefined ? bounds.width / 2 : clientX - bounds.left;
  const pointY =
    clientY === undefined ? bounds.height / 2 : clientY - bounds.top;
  const diagramX = (pointX - offsetX) / scale;
  const diagramY = (pointY - offsetY) / scale;
  offsetX = pointX - diagramX * next;
  offsetY = pointY - diagramY * next;
  scale = next;
  automaticFit = false;
}

function handleWheel(event: WheelEvent) {
  if ((!wheelZoomEnabled && !event.ctrlKey) || renderState !== "rendered")
    return;
  event.preventDefault();
  zoomAt(scale * Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
}

function startPan(event: PointerEvent) {
  if (
    renderState !== "rendered" ||
    (event.pointerType === "mouse" && event.button !== 0)
  )
    return;
  activePointerId = event.pointerId;
  dragging = true;
  automaticFit = false;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOffsetX = offsetX;
  dragOffsetY = offsetY;
  viewport?.setPointerCapture(event.pointerId);
}

function movePan(event: PointerEvent) {
  if (!dragging || event.pointerId !== activePointerId) return;
  offsetX = dragOffsetX + event.clientX - dragStartX;
  offsetY = dragOffsetY + event.clientY - dragStartY;
}

function endPan(event: PointerEvent) {
  if (event.pointerId !== activePointerId) return;
  dragging = false;
  activePointerId = undefined;
  if (viewport?.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
}

async function render(
  nextSource: string,
  target: HTMLElement | null,
  resetViewport: boolean,
) {
  if (!target || !nextSource.trim()) {
    renderState = nextSource.trim() ? "loading" : "error";
    return;
  }
  const current = ++generation;
  renderState = "loading";
  if (resetViewport) automaticFit = true;
  target.replaceChildren();
  const result = await renderMermaid(nextSource, target);
  if (current !== generation || host !== target || !target.isConnected) return;
  if (
    !result.ok ||
    !mountMermaidSvg(target, result.svg) ||
    !prepareDiagram(target)
  ) {
    renderState = "error";
    return;
  }
  renderState = "rendered";
  if (automaticFit) requestAnimationFrame(fitDiagram);
}

$effect(() => {
  void render(source, host, true);
});

$effect(() => {
  if (!host) return;
  const observer = new MutationObserver(() => void render(source, host, false));
  observer.observe(host.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  return () => {
    generation += 1;
    observer.disconnect();
  };
});

$effect(() => {
  if (!viewport) return;
  const observer = new ResizeObserver(() => {
    if (automaticFit) fitDiagram();
  });
  observer.observe(viewport);
  return () => observer.disconnect();
});
</script>

<div
  class={`relative min-h-0 min-w-0 touch-none overflow-hidden bg-background ${dragging ? "cursor-grabbing" : "cursor-grab"} ${className}`}
  role="region"
  aria-label={ariaLabel}
  bind:this={viewport}
  onwheel={handleWheel}
  onpointerdown={startPan}
  onpointermove={movePan}
  onpointerup={endPan}
  onpointercancel={endPan}
>
  {#if renderState === "loading"}
    <div
      class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground"
    >
      <div class="grid place-items-center gap-2">
        <Spinner class="size-5 text-primary" />
        <span>Rendering diagram</span>
      </div>
    </div>
  {:else if renderState === "error"}
    <div class="absolute inset-0 grid place-items-center overflow-auto p-4">
      <div class="grid w-full max-w-3xl gap-3">
        <p class="m-0 text-sm text-destructive">
          Diagram could not be rendered
        </p>
        <pre class="m-0 overflow-auto rounded-md bg-muted p-3 text-xs"><code
            >{source}</code
          ></pre>
      </div>
    </div>
  {/if}

  <div
    class="mermaid-svg-host absolute left-0 top-0 origin-top-left touch-none select-none"
    style:transform
    bind:this={host}
  ></div>

  {#if renderState === "rendered"}
    <div
      class="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-sm"
      role="toolbar"
      aria-label="Diagram controls"
      tabindex="-1"
      onpointerdown={(event) => event.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon-xs"
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
        size="icon-xs"
        ariaLabel="Zoom out"
        title="Zoom out"
        disabled={scale <= MIN_SCALE}
        onclick={() => zoomAt(scale / ZOOM_STEP)}
      >
        <ZoomOut class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel="Zoom in"
        title="Zoom in"
        disabled={scale >= MAX_SCALE}
        onclick={() => zoomAt(scale * ZOOM_STEP)}
      >
        <ZoomIn class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel="Fit diagram to view"
        title="Fit to view"
        onclick={fitDiagram}
      >
        <Maximize class="size-3" />
      </Button>
      {#if onOpenStandalone}
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Open diagram in tab"
          title="Open diagram in tab"
          onclick={onOpenStandalone}
        >
          <ExternalLink class="size-3" />
        </Button>
      {/if}
    </div>
  {/if}
</div>

<style>
.mermaid-svg-host :global(svg) {
  display: block;
  max-width: none;
  height: auto;
  pointer-events: none;
}
</style>
