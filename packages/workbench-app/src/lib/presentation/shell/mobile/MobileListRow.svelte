<script lang="ts">
import type { Snippet } from "svelte";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";
import type { PanelViewIcon } from "../shell-types.js";
import MobileActionSheet from "./MobileActionSheet.svelte";
import {
  LONG_PRESS_MS,
  SWIPE_ACTION_WIDTH,
  classifySwipeIntent,
  exceedsLongPressSlop,
  settleSwipe,
  swipeOffset,
  swipeRestOffset,
  swipeWidth,
  type MobileRowSwipeAction,
  type SwipeIntent,
  type SwipeSide,
} from "./mobile-swipe.js";
import { createSwipeRowId, openSwipeRow } from "./mobile-swipe-state.svelte.js";

/**
 * The single row shape used by every mobile list, drawn inside a
 * `MobileSection` card: a leading signal, a title that wraps to two lines, one
 * supporting line, and the time or count at the right. Actions stay out of the
 * way: long-press (or the accessible "Actions for" button) opens the full
 * sheet, and optional swipe actions reveal the one or two that matter most.
 */
let {
  title,
  detail,
  meta,
  icon,
  tone,
  pulse = false,
  count,
  chevron = true,
  selected = false,
  menuItems,
  menuTitle,
  swipeLeading,
  swipeTrailing,
  onclick,
  leading,
  trailing,
}: {
  title: string;
  /** The single supporting line under the title. */
  detail?: string;
  /** Secondary label at the top right, e.g. a relative time. */
  meta?: string;
  icon?: PanelViewIcon;
  tone?: StatusTone;
  pulse?: boolean;
  count?: number;
  chevron?: boolean;
  selected?: boolean;
  /** Opens these items in a bottom sheet on long-press or context menu. */
  menuItems?: ContextMenuItem[];
  menuTitle?: string;
  /** Revealed by swiping right: one primary action, e.g. Done. */
  swipeLeading?: MobileRowSwipeAction;
  /** Revealed by swiping left: up to two actions, e.g. Pin and Delete. */
  swipeTrailing?: MobileRowSwipeAction[];
  onclick?: () => void;
  leading?: Snippet;
  trailing?: Snippet;
} = $props();

const Icon = $derived(icon);
const hasMenu = $derived(Boolean(menuItems?.length));
const hasTile = $derived(Boolean(leading || icon));
const hasDot = $derived(!hasTile && Boolean(tone));
const trailingActions = $derived((swipeTrailing ?? []).slice(0, 2));
const widths = $derived({
  leading: swipeLeading ? SWIPE_ACTION_WIDTH : 0,
  trailing: swipeWidth(trailingActions.length),
});
const swipeable = $derived(widths.leading > 0 || widths.trailing > 0);

let menuOpen = $state(false);

// Swipe state. `openSide` only counts while this row is the open one.
const rowId = createSwipeRowId();
let rowEl = $state<HTMLElement>();
let openSide = $state<SwipeSide>();
let dragging = $state(false);
let dragOffset = $state(0);
const side = $derived(openSwipeRow.id === rowId ? openSide : undefined);
const offset = $derived(dragging ? dragOffset : swipeRestOffset(side, widths));

function setOpen(next: SwipeSide | undefined) {
  openSide = next;
  if (next) openSwipeRow.id = rowId;
  else if (openSwipeRow.id === rowId) openSwipeRow.id = undefined;
}

// Tapping elsewhere or scrolling closes an open row.
$effect(() => {
  if (!side) return;
  const closeOutside = (event: PointerEvent) => {
    if (!rowEl?.contains(event.target as Node)) setOpen(undefined);
  };
  const close = () => setOpen(undefined);
  document.addEventListener("pointerdown", closeOutside, true);
  document.addEventListener("scroll", close, true);
  return () => {
    document.removeEventListener("pointerdown", closeOutside, true);
    document.removeEventListener("scroll", close, true);
  };
});

$effect(() => () => {
  if (openSwipeRow.id === rowId) openSwipeRow.id = undefined;
});

type Press = {
  pointerId: number;
  x: number;
  y: number;
  startOffset: number;
  intent: SwipeIntent;
  lastX: number;
  lastT: number;
  velocity: number;
};

let press: Press | undefined;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
// The click that follows a drag or long-press must not activate the row.
let suppressClick = false;

function clearLongPress() {
  if (longPressTimer !== undefined) clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  suppressClick = false;
  press = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startOffset: offset,
    intent: "pending",
    lastX: event.clientX,
    lastT: event.timeStamp,
    velocity: 0,
  };
  clearLongPress();
  if (hasMenu && event.pointerType !== "mouse") {
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      if (!press || press.intent === "horizontal") return;
      press = undefined;
      suppressClick = true;
      menuOpen = true;
    }, LONG_PRESS_MS);
  }
}

function onPointerMove(event: PointerEvent) {
  if (!press || event.pointerId !== press.pointerId) return;
  const dx = event.clientX - press.x;
  const dy = event.clientY - press.y;
  if (press.intent === "pending") {
    if (exceedsLongPressSlop(dx, dy)) clearLongPress();
    const intent = swipeable
      ? classifySwipeIntent(dx, dy)
      : exceedsLongPressSlop(dx, dy)
        ? "vertical"
        : "pending";
    if (intent === "vertical") {
      press = undefined;
      return;
    }
    if (intent === "horizontal") {
      press.intent = "horizontal";
      dragging = true;
      dragOffset = press.startOffset;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers have nothing to capture; dragging still works.
      }
    }
  }
  if (press.intent !== "horizontal") return;
  dragOffset = swipeOffset(press.startOffset, dx, widths);
  const dt = event.timeStamp - press.lastT;
  if (dt > 0) {
    press.velocity =
      0.6 * ((event.clientX - press.lastX) / dt) + 0.4 * press.velocity;
    press.lastX = event.clientX;
    press.lastT = event.timeStamp;
  }
}

function endPress(event: PointerEvent, cancelled: boolean) {
  clearLongPress();
  const current = press;
  press = undefined;
  if (!current || current.intent !== "horizontal") return;
  suppressClick = true;
  // A pause before release means the flick speed no longer applies.
  const stale = event.timeStamp - current.lastT > 120;
  const velocity = cancelled || stale ? 0 : current.velocity;
  const next = settleSwipe(dragOffset, velocity, widths);
  dragging = false;
  setOpen(next);
}

function onClickCapture(event: MouseEvent) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (side) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(undefined);
  }
}

function onContextMenu(event: MouseEvent) {
  if (!hasMenu) return;
  event.preventDefault();
  clearLongPress();
  menuOpen = true;
}

function runAction(action: MobileRowSwipeAction) {
  setOpen(undefined);
  action.onSelect();
}

const ACTION_TONE: Record<string, string> = {
  success: "bg-success text-success-foreground",
  info: "bg-info text-info-foreground",
  destructive: "bg-destructive-solid text-destructive-solid-foreground",
};
</script>

{#snippet actionButton(action: MobileRowSwipeAction)}
  {@const ActionIcon = action.icon}
  <button
    type="button"
    class={cn(
      "flex flex-col items-center justify-center gap-1 text-caption",
      action.tone ? ACTION_TONE[action.tone] : "bg-muted text-foreground",
    )}
    style:width={`${SWIPE_ACTION_WIDTH}px`}
    onclick={() => runAction(action)}
  >
    {#if ActionIcon}<ActionIcon size={18} strokeWidth={1.9} />{/if}
    {action.label}
  </button>
{/snippet}

<div
  bind:this={rowEl}
  class="mobile-row"
  class:swipeable
  class:selected
  class:has-tile={hasTile}
  class:has-dot={hasDot}
>
  {#if swipeLeading}
    <div
      class="absolute inset-y-0 left-0 flex"
      inert={side !== "leading"}
      style:width={`${widths.leading}px`}
    >
      {@render actionButton(swipeLeading)}
    </div>
  {/if}
  {#if trailingActions.length}
    <div
      class="absolute inset-y-0 right-0 flex"
      inert={side !== "trailing"}
      style:width={`${widths.trailing}px`}
    >
      {#each trailingActions as action (action.label)}
        {@render actionButton(action)}
      {/each}
    </div>
  {/if}

  <div
    class="mobile-row-surface"
    class:dragging
    style:transform={offset ? `translateX(${offset}px)` : undefined}
    role="presentation"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={(event) => endPress(event, false)}
    onpointercancel={(event) => endPress(event, true)}
    onclickcapture={onClickCapture}
    oncontextmenu={onContextMenu}
  >
    <!-- Read in reading order (title, supporting line, then the time) even
         though the time sits visually on the title line. -->
    <button
      type="button"
      class="mobile-row-main"
      aria-label={[title, detail, meta].filter(Boolean).join(" ")}
      {onclick}
    >
      {#if leading}
        {@render leading()}
      {:else if Icon}
        <span
          class="flex size-8 flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Icon size={17} strokeWidth={1.9} />
        </span>
      {:else if tone}
        <StatusDot {tone} {pulse} size="md" class="mt-1.5" />
      {/if}

      <span class="grid min-w-0 flex-1 gap-0.5 text-left">
        <span class="flex min-w-0 items-baseline gap-2">
          <span class="line-clamp-2 min-w-0 flex-1 text-ui text-foreground"
            >{title}</span
          >
          {#if meta}
            <span class="flex-none text-caption text-muted-foreground"
              >{meta}</span
            >
          {/if}
        </span>
        {#if detail}
          <span class="truncate text-caption text-muted-foreground"
            >{detail}</span
          >
        {/if}
      </span>
    </button>

    {#if trailing}
      <span class="flex flex-none items-center pr-2">{@render trailing()}</span>
    {:else if count !== undefined && count > 0}
      <span
        class="mr-3 flex-none self-center rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
        >{count}</span
      >
    {/if}

    {#if chevron && !hasMenu}
      <span class="mobile-row-chevron" aria-hidden="true">
        <ChevronRight size={16} strokeWidth={1.9} />
      </span>
    {/if}

    {#if hasMenu}
      <button
        type="button"
        class="sr-only"
        aria-haspopup="dialog"
        onclick={() => (menuOpen = true)}
      >
        Actions for {title}
      </button>
    {/if}
  </div>
</div>

{#if hasMenu && menuItems}
  <MobileActionSheet
    open={menuOpen}
    title={menuTitle ?? title}
    items={menuItems}
    onOpenChange={(open) => (menuOpen = open)}
  />
{/if}

<style>
.mobile-row {
  --row-inset: 0.875rem;
  position: relative;
  width: 100%;
  min-height: 3.5rem;
  overflow: hidden;
}

.mobile-row.has-dot {
  --row-inset: 2.125rem;
}

.mobile-row.has-tile {
  --row-inset: 3.625rem;
}

.mobile-row-surface {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 3.5rem;
  background: var(--card);
  transition: transform 180ms ease-out;
}

.mobile-row.swipeable .mobile-row-surface {
  touch-action: pan-y;
}

.mobile-row-surface.dragging {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .mobile-row-surface {
    transition: none;
  }
}

/* Inset hairline, aligned with the text rather than the leading signal. */
.mobile-row-surface::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: var(--row-inset);
  height: 1px;
  background: var(--border-subtle);
  pointer-events: none;
}

.mobile-row.selected .mobile-row-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--hover);
  pointer-events: none;
}

.mobile-row-main {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.625rem 0.75rem 0.625rem 0.875rem;
  text-align: left;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.mobile-row-main:active {
  background: var(--muted);
}

.mobile-row-chevron {
  display: flex;
  flex: none;
  align-items: center;
  padding-right: 0.75rem;
  color: var(--muted-foreground);
}
</style>
