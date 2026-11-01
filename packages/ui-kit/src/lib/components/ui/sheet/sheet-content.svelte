<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import type { ComponentProps, Snippet } from "svelte";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/utils";
import SheetOverlay from "./sheet-overlay.svelte";
import SheetPortal from "./sheet-portal.svelte";
import {
  outwardSheetSwipeDistance,
  SHEET_SWIPE_AXIS_DOMINANCE,
  SHEET_SWIPE_INTENT_DISTANCE,
  sheetSwipeAxis,
  sheetSwipeDismissTranslation,
  sheetSwipeTranslation,
  shouldDismissSheetSwipe,
  type SheetSwipeSide,
} from "./sheet-swipe";

let {
  ref = $bindable(null),
  class: className,
  style: styleProp,
  side = "right",
  portalProps,
  swipeToDismiss = false,
  onSwipeDismiss,
  children,
  ...restProps
}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
  portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
  side?: "top" | "right" | "bottom" | "left";
  swipeToDismiss?: boolean;
  onSwipeDismiss?: () => void;
  children: Snippet;
} = $props();

const swipeEnabled = $derived(
  swipeToDismiss && (side === "left" || side === "right" || side === "bottom"),
);
/** Bottom sheets are pulled down by their grab handle or any element marked
 * `data-sheet-drag-region` (e.g. a header), so body content keeps scrolling. */
const pullDown = $derived(swipeEnabled && side === "bottom");

let swipeTranslate = $state<number>();
let swiping = $state(false);
let settling = $state(false);
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let dismissAfterSettlement = false;
let gesture:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      startTime: number;
      locked: boolean;
    }
  | undefined;

function clearSettleTimer() {
  if (settleTimer === undefined) return;
  clearTimeout(settleTimer);
  settleTimer = undefined;
}

function finishSettlement() {
  if (!settling) return;
  const dismiss = dismissAfterSettlement;
  clearSettleTimer();
  dismissAfterSettlement = false;
  settling = false;
  swiping = false;
  swipeTranslate = undefined;
  if (dismiss) onSwipeDismiss?.();
}

function resetGesture() {
  gesture = undefined;
  clearSettleTimer();
  dismissAfterSettlement = false;
  settling = false;
  swiping = false;
  swipeTranslate = undefined;
}

$effect(() => {
  const element = ref;
  if (!element || !swipeEnabled) return;

  const contentElement = element as HTMLElement;
  const swipeSide = side as SheetSwipeSide;
  const axis = sheetSwipeAxis(swipeSide);
  const extent = () => {
    const rect = contentElement.getBoundingClientRect();
    return axis === "x" ? rect.width : rect.height;
  };

  function releasePointer(pointerId: number) {
    if (contentElement.hasPointerCapture(pointerId)) {
      contentElement.releasePointerCapture(pointerId);
    }
  }

  function settle(dismiss: boolean) {
    const activeGesture = gesture;
    gesture = undefined;
    if (activeGesture) releasePointer(activeGesture.pointerId);

    swiping = false;
    settling = true;
    dismissAfterSettlement = dismiss;
    swipeTranslate = dismiss
      ? sheetSwipeDismissTranslation(swipeSide, extent())
      : 0;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishSettlement();
      return;
    }

    clearSettleTimer();
    settleTimer = setTimeout(finishSettlement, 240);
  }

  function handlePointerDown(event: PointerEvent) {
    if (
      settling ||
      gesture ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && axis === "x")
    ) {
      return;
    }
    if (
      axis === "y" &&
      !(
        event.target instanceof Element &&
        event.target.closest("[data-sheet-drag-region]") &&
        !event.target.closest("button, input, textarea, select, a")
      )
    ) {
      return;
    }

    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      locked: false,
    };
  }

  function handlePointerMove(event: PointerEvent) {
    const activeGesture = gesture;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;

    const deltaX = event.clientX - activeGesture.startX;
    const deltaY = event.clientY - activeGesture.startY;
    const along = axis === "x" ? deltaX : deltaY;
    const across = axis === "x" ? deltaY : deltaX;

    if (!activeGesture.locked) {
      const absoluteAlong = Math.abs(along);
      const absoluteAcross = Math.abs(across);
      if (
        absoluteAlong < SHEET_SWIPE_INTENT_DISTANCE &&
        absoluteAcross < SHEET_SWIPE_INTENT_DISTANCE
      ) {
        return;
      }
      if (absoluteAcross > absoluteAlong) {
        gesture = undefined;
        return;
      }
      if (absoluteAlong < absoluteAcross * SHEET_SWIPE_AXIS_DOMINANCE) return;

      activeGesture.locked = true;
      contentElement.setPointerCapture(event.pointerId);
      swiping = true;
    }

    event.preventDefault();
    swipeTranslate = sheetSwipeTranslation(swipeSide, along);
  }

  function handlePointerEnd(event: PointerEvent) {
    const activeGesture = gesture;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
    if (!activeGesture.locked) {
      gesture = undefined;
      return;
    }

    const along =
      axis === "x"
        ? event.clientX - activeGesture.startX
        : event.clientY - activeGesture.startY;
    const distance = outwardSheetSwipeDistance(swipeSide, along);
    const elapsed = Math.max(1, event.timeStamp - activeGesture.startTime);
    settle(
      shouldDismissSheetSwipe({
        distance,
        size: extent(),
        velocity: distance / elapsed,
      }),
    );
  }

  function handlePointerCancel(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.locked) settle(false);
    else gesture = undefined;
  }

  function handleTransitionEnd(event: TransitionEvent) {
    if (event.target === contentElement && event.propertyName === "translate") {
      finishSettlement();
    }
  }

  contentElement.addEventListener("pointerdown", handlePointerDown, true);
  contentElement.addEventListener("pointermove", handlePointerMove, true);
  contentElement.addEventListener("pointerup", handlePointerEnd, true);
  contentElement.addEventListener("pointercancel", handlePointerCancel, true);
  contentElement.addEventListener("transitionend", handleTransitionEnd);

  return () => {
    contentElement.removeEventListener("pointerdown", handlePointerDown, true);
    contentElement.removeEventListener("pointermove", handlePointerMove, true);
    contentElement.removeEventListener("pointerup", handlePointerEnd, true);
    contentElement.removeEventListener(
      "pointercancel",
      handlePointerCancel,
      true,
    );
    contentElement.removeEventListener("transitionend", handleTransitionEnd);
    resetGesture();
  };
});
</script>

<SheetPortal {...portalProps}>
  <SheetOverlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(
      "bg-panel text-foreground data-open:animate-in data-closed:animate-out fixed z-50 flex flex-col overflow-hidden shadow-overlay outline-none duration-200",
      side === "right" &&
        "data-open:slide-in-from-right data-closed:slide-out-to-right inset-y-0 right-0 h-full w-[min(90vw,24rem)] border-l",
      side === "left" &&
        "data-open:slide-in-from-left data-closed:slide-out-to-left inset-y-0 left-0 h-full w-[min(85vw,20rem)] border-r",
      side === "top" &&
        "data-open:slide-in-from-top data-closed:slide-out-to-top inset-x-0 top-0 h-auto max-h-[85vh] border-b",
      side === "bottom" &&
        "data-open:slide-in-from-bottom data-closed:slide-out-to-bottom inset-x-0 bottom-0 h-auto max-h-[85vh] border-t",
      swipeEnabled && !pullDown && "touch-pan-y [&_*]:touch-pan-y",
      pullDown && "[&_[data-sheet-drag-region]]:touch-none",
      swiping && "transition-none will-change-[translate]",
      settling && "transition-[translate] ease-out",
      className,
    )}
    style={swipeTranslate === undefined
      ? styleProp
      : `${styleProp ? `${styleProp};` : ""}translate:${side === "bottom" ? `0 ${swipeTranslate}px` : `${swipeTranslate}px 0`}`}
    {...restProps}
  >
    {#if pullDown}
      <div
        class="flex h-5 flex-none cursor-grab items-center justify-center"
        data-sheet-drag-region
        aria-hidden="true"
      >
        <span class="h-1 w-9 rounded-full bg-border"></span>
      </div>
    {/if}
    {@render children?.()}
  </DialogPrimitive.Content>
</SheetPortal>
