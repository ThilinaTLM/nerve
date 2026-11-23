<script lang="ts" module>
import type { Attachment } from "svelte/attachments";
import type { PanelSplitArea } from "./panel-split-sizing";

/** What the `area` snippet receives for each area. */
export interface PanelSplitAreaProps {
  /** The area being rendered. */
  area: PanelSplitArea;
  /** False while the area is collapsed to its header. */
  open: boolean;
  /** Collapses or expands the area; a no-op for areas that are not collapsible. */
  toggle: () => void;
  /**
   * Attach to the element holding the area's natural content (below the
   * header) so automatic sizing can fit it.
   */
  measure: Attachment<HTMLElement>;
  /**
   * The content is taller than the area's target height. Scroll only then,
   * so no scrollbar flashes while the height animates to fit.
   */
  overflows: boolean;
}
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import {
  isAreaOpen,
  isDividerDraggable,
  panelSplitHeights,
  sizeFor,
  withCollapsed,
  withSize,
  type PanelSplitLayout,
} from "./panel-split-sizing";

let {
  areas,
  layout = $bindable({ collapsed: {}, sizes: {} }),
  onChange,
  area,
  keyStepPx = 16,
  class: className,
  areaClass,
}: {
  /** The stacked areas, top to bottom. */
  areas: readonly PanelSplitArea[];
  /** Collapsed flags and manual sizes; plain data, so it can be persisted as is. */
  layout?: PanelSplitLayout;
  /** Called with the new layout after every user change (toggle, drag, key). */
  onChange?: (layout: PanelSplitLayout) => void;
  /** Renders one area's header and body. */
  area: Snippet<[PanelSplitAreaProps]>;
  /** Pixels a divider moves per arrow key press. */
  keyStepPx?: number;
  /** Classes of the root element. */
  class?: string;
  /** Classes of every area's wrapper. */
  areaClass?: string;
} = $props();

const DIVIDER_PX = 1;

let groupPx = $state(0);
const measured = $state<Record<string, number>>({});

const measurers: Record<string, Attachment<HTMLElement>> = {};
/** Reports an element's natural height while it is mounted. */
function measurerFor(id: string): Attachment<HTMLElement> {
  return (measurers[id] ??= (element) => {
    const set = () => (measured[id] = element.offsetHeight);
    const observer = new ResizeObserver(set);
    observer.observe(element);
    set();
    return () => observer.disconnect();
  });
}

/** Natural height of an area including its header; 0 while unknown. */
const naturalPx = (spec: PanelSplitArea) =>
  measured[spec.id] ? (spec.headerPx ?? 0) + measured[spec.id]! : 0;

const totalPx = $derived(
  Math.max(0, groupPx - Math.max(0, areas.length - 1) * DIVIDER_PX),
);
const heights = $derived(
  panelSplitHeights({
    areas,
    layout,
    totalPx,
    contentPx: Object.fromEntries(
      areas.map((spec) => [spec.id, naturalPx(spec)]),
    ),
  }),
);

function update(next: PanelSplitLayout): void {
  layout = next;
  onChange?.(next);
}

// ---- Motion: every change animates, except a drag and a panel resize. ----
let dragging = $state<{ index: number; startY: number; startPx: number }>();
let settled = $state(false);
let settleFrame = 0;
$effect(() => {
  void groupPx;
  void areas.map((spec) => spec.id).join();
  settled = false;
  cancelAnimationFrame(settleFrame);
  settleFrame = requestAnimationFrame(() => (settled = true));
  return () => cancelAnimationFrame(settleFrame);
});
const motion = $derived(
  settled && !dragging
    ? "transition-[height] duration-200 ease-out motion-reduce:transition-none"
    : "",
);

/** Collapses or expands one area. */
export function toggle(id: string): void {
  const spec = areas.find((candidate) => candidate.id === id);
  if (!spec || spec.collapsible === false) return;
  update(withCollapsed(layout, id, isAreaOpen(spec, layout)));
}

/** Expands one area if it is collapsed. */
export function open(id: string): void {
  const spec = areas.find((candidate) => candidate.id === id);
  if (spec && !isAreaOpen(spec, layout)) toggle(id);
}

// ---- Dividers: a drag sets the height of the area above; double-click makes it automatic again. ----
const draggable = (index: number) => isDividerDraggable(areas, layout, index);
function resize(index: number, px: number): void {
  update(withSize(layout, areas[index]!.id, sizeFor(px, totalPx)));
}
function reset(index: number): void {
  update(withSize(layout, areas[index]!.id, null));
}

function onPointerDown(event: PointerEvent, index: number): void {
  if (event.button !== 0 || !draggable(index)) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging = { index, startY: event.clientY, startPx: heights[index]! };
}
function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  resize(dragging.index, dragging.startPx + event.clientY - dragging.startY);
}
function endDrag(): void {
  dragging = undefined;
}
function onKeydown(event: KeyboardEvent, index: number): void {
  if (!draggable(index)) return;
  const step =
    event.key === "ArrowUp"
      ? -keyStepPx
      : event.key === "ArrowDown"
        ? keyStepPx
        : 0;
  if (step) resize(index, heights[index]! + step);
  else if (event.key === "Enter") reset(index);
  else return;
  event.preventDefault();
}
</script>

{#snippet divider(index: number, label: string | undefined)}
  {@const active = draggable(index)}
  {@const share = totalPx ? Math.round((heights[index]! / totalPx) * 100) : 0}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    role="separator"
    aria-orientation="horizontal"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={share}
    aria-disabled={!active}
    tabindex={active ? 0 : -1}
    title={active
      ? "Drag to resize, double-click for automatic size"
      : undefined}
    class={cn(
      "relative z-10 h-px w-full shrink-0 bg-border transition-colors outline-none",
      active &&
        "cursor-row-resize after:absolute after:inset-x-0 after:-top-1 after:h-2 hover:bg-ring focus-visible:bg-ring",
      dragging?.index === index && "bg-ring",
    )}
    onpointerdown={(event) => onPointerDown(event, index)}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onlostpointercapture={endDrag}
    ondblclick={() => {
      if (active) reset(index);
    }}
    onkeydown={(event) => onKeydown(event, index)}
  ></div>
{/snippet}

<div
  class={cn(
    "flex min-h-0 flex-1 flex-col overflow-hidden",
    dragging && "cursor-row-resize select-none",
    className,
  )}
  bind:clientHeight={groupPx}
>
  {#each areas as spec, index (spec.id)}
    <div
      class={cn("min-h-0 shrink-0 overflow-hidden", areaClass, motion)}
      style:height="{heights[index] ?? 0}px"
    >
      {@render area({
        area: spec,
        open: isAreaOpen(spec, layout),
        toggle: () => toggle(spec.id),
        measure: measurerFor(spec.id),
        overflows: naturalPx(spec) > (heights[index] ?? 0) + 0.5,
      })}
    </div>
    {#if index < areas.length - 1}
      {@render divider(index, spec.resizeLabel)}
    {/if}
  {/each}
</div>
