<script lang="ts">
import type { Snippet } from "svelte";
import type { Attachment } from "svelte/attachments";
import { cn } from "@nervekit/ui-kit/utils";
import { gitPanelLayout } from "../state/git-panel-view-state.svelte";
import { capFor, draggable, HEADER_PX, splitHeights } from "./git-split-sizing";

type Section = "branch" | "changes";
type Divider = "list" | "branch";
type Measure = Attachment<HTMLElement>;
type SectionProps = { open: boolean; toggle: () => void };
/**
 * `overflows`: the content is taller than the area's target height. Scroll
 * only then, so no scrollbar flashes while the height animates to fit.
 */
type MeasuredProps = { measure: Measure; overflows: boolean };

let {
  list,
  branch,
  changes,
}: {
  /** Without a list the two sections share the whole height. */
  list?: Snippet<[MeasuredProps]>;
  /** `measure` goes on the element holding the section body's natural content. */
  branch: Snippet<[SectionProps & MeasuredProps]>;
  changes: Snippet<[SectionProps]>;
} = $props();

const DIVIDER_PX = 1;
const KEY_STEP_PX = 16;

const layout = gitPanelLayout();
const hasList = $derived(list !== undefined);
let groupPx = $state(0);
let listContentPx = $state(0);
let branchBodyPx = $state(0);

/** Reports an element's natural height while it is mounted. */
const measureInto =
  (set: (px: number) => void): Measure =>
  (element) => {
    const observer = new ResizeObserver(() => set(element.offsetHeight));
    observer.observe(element);
    set(element.offsetHeight);
    return () => observer.disconnect();
  };
const measureList = measureInto((px) => (listContentPx = px));
const measureBranch = measureInto((px) => (branchBodyPx = px));

const flags = $derived({
  hasList,
  branchOpen: !layout.branch.collapsed,
  changesOpen: !layout.changes.collapsed,
});
const totalPx = $derived(Math.max(0, groupPx - (hasList ? 2 : 1) * DIVIDER_PX));
const heights = $derived(
  splitHeights({
    ...flags,
    totalPx,
    listContentPx,
    branchContentPx: branchBodyPx ? HEADER_PX + branchBodyPx : 0,
    listCap: layout.listCap,
    branchCap: layout.branch.cap,
  }),
);

// Without a list one section always stays open: two headers would leave a hole.
$effect(() => {
  if (!hasList && layout.branch.collapsed && layout.changes.collapsed) {
    layout.changes.collapsed = false;
    layout.save();
  }
});

// ---- Motion: every change animates, except a drag and a panel resize. ----
let dragging = $state<{
  divider: Divider;
  startY: number;
  startPx: number;
}>();
let settled = $state(false);
let settleFrame = 0;
$effect(() => {
  void groupPx;
  void hasList;
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

function toggle(section: Section): void {
  const target = layout[section];
  target.collapsed = !target.collapsed;
  if (!hasList && layout.branch.collapsed && layout.changes.collapsed)
    layout[section === "branch" ? "changes" : "branch"].collapsed = false;
  layout.save();
}

export function openSection(section: Section): void {
  if (layout[section].collapsed) toggle(section);
}

// ---- Dividers: a drag sets the cap of the area above; double-click resets. ----
const heightAbove = (divider: Divider) =>
  divider === "list" ? heights.list : heights.branch;
function setCap(divider: Divider, cap: number | null): void {
  if (divider === "list") layout.listCap = cap;
  else layout.branch.cap = cap;
}
function resize(divider: Divider, px: number): void {
  setCap(divider, capFor(px, totalPx));
}

function onPointerDown(event: PointerEvent, divider: Divider): void {
  if (event.button !== 0 || !draggable(divider, flags)) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging = { divider, startY: event.clientY, startPx: heightAbove(divider) };
}
function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  resize(dragging.divider, dragging.startPx + event.clientY - dragging.startY);
}
function endDrag(): void {
  if (!dragging) return;
  dragging = undefined;
  layout.save();
}
function onKeydown(event: KeyboardEvent, divider: Divider): void {
  if (!draggable(divider, flags)) return;
  const step =
    event.key === "ArrowUp"
      ? -KEY_STEP_PX
      : event.key === "ArrowDown"
        ? KEY_STEP_PX
        : 0;
  if (step) resize(divider, heightAbove(divider) + step);
  else if (event.key === "Enter") setCap(divider, null);
  else return;
  event.preventDefault();
  layout.save();
}
</script>

{#snippet divider(which: Divider, label: string)}
  {@const active = draggable(which, flags)}
  {@const share = totalPx
    ? Math.round((heightAbove(which) / totalPx) * 100)
    : 0}
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
      dragging?.divider === which && "bg-ring",
    )}
    onpointerdown={(event) => onPointerDown(event, which)}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onlostpointercapture={endDrag}
    ondblclick={() => {
      if (!active) return;
      setCap(which, null);
      layout.save();
    }}
    onkeydown={(event) => onKeydown(event, which)}
  ></div>
{/snippet}

<div
  class={cn(
    "-mx-2 flex min-h-0 flex-1 flex-col overflow-hidden",
    dragging && "cursor-row-resize select-none",
  )}
  bind:clientHeight={groupPx}
>
  {#if list}
    <div
      class={cn("min-h-0 shrink-0 overflow-hidden px-2", motion)}
      style:height="{heights.list}px"
    >
      {@render list({
        measure: measureList,
        overflows: listContentPx > heights.list + 0.5,
      })}
    </div>
    {@render divider("list", "Resize repository list")}
  {/if}
  <div
    class={cn("min-h-0 shrink-0 overflow-hidden px-2", motion)}
    style:height="{heights.branch}px"
  >
    {@render branch({
      open: flags.branchOpen,
      toggle: () => toggle("branch"),
      measure: measureBranch,
      overflows: HEADER_PX + branchBodyPx > heights.branch + 0.5,
    })}
  </div>
  {@render divider("branch", "Resize selected branch")}
  <div
    class={cn("min-h-0 shrink-0 overflow-hidden px-2", motion)}
    style:height="{heights.changes}px"
  >
    {@render changes({
      open: flags.changesOpen,
      toggle: () => toggle("changes"),
    })}
  </div>
</div>
