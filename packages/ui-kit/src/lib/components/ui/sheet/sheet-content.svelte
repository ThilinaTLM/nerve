<script lang="ts">
import { Dialog as DialogPrimitive } from "bits-ui";
import type { ComponentProps, Snippet } from "svelte";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/core/utils";
import SheetOverlay from "./sheet-overlay.svelte";
import SheetPortal from "./sheet-portal.svelte";
import {
  outwardSheetSwipeDistance,
  SHEET_SWIPE_AXIS_DOMINANCE,
  SHEET_SWIPE_INTENT_DISTANCE,
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
  swipeToDismiss && (side === "left" || side === "right"),
);

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
      horizontal: boolean;
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
      ? (swipeSide === "left" ? -1 : 1) *
        contentElement.getBoundingClientRect().width
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
      event.pointerType === "mouse"
    ) {
      return;
    }

    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      horizontal: false,
    };
  }

  function handlePointerMove(event: PointerEvent) {
    const activeGesture = gesture;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;

    const deltaX = event.clientX - activeGesture.startX;
    const deltaY = event.clientY - activeGesture.startY;

    if (!activeGesture.horizontal) {
      const absoluteX = Math.abs(deltaX);
      const absoluteY = Math.abs(deltaY);
      if (
        absoluteX < SHEET_SWIPE_INTENT_DISTANCE &&
        absoluteY < SHEET_SWIPE_INTENT_DISTANCE
      ) {
        return;
      }
      if (absoluteY > absoluteX) {
        gesture = undefined;
        return;
      }
      if (absoluteX < absoluteY * SHEET_SWIPE_AXIS_DOMINANCE) return;

      activeGesture.horizontal = true;
      contentElement.setPointerCapture(event.pointerId);
      swiping = true;
    }

    event.preventDefault();
    swipeTranslate = sheetSwipeTranslation(swipeSide, deltaX);
  }

  function handlePointerEnd(event: PointerEvent) {
    const activeGesture = gesture;
    if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
    if (!activeGesture.horizontal) {
      gesture = undefined;
      return;
    }

    const deltaX = event.clientX - activeGesture.startX;
    const distance = outwardSheetSwipeDistance(swipeSide, deltaX);
    const elapsed = Math.max(1, event.timeStamp - activeGesture.startTime);
    settle(
      shouldDismissSheetSwipe({
        distance,
        width: contentElement.getBoundingClientRect().width,
        velocity: distance / elapsed,
      }),
    );
  }

  function handlePointerCancel(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.horizontal) settle(false);
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
      "bg-sidebar text-foreground data-open:animate-in data-closed:animate-out fixed z-50 flex flex-col overflow-hidden shadow-lg outline-none duration-200",
      side === "right" &&
        "data-open:slide-in-from-right data-closed:slide-out-to-right inset-y-0 right-0 h-full w-[min(90vw,24rem)] border-l",
      side === "left" &&
        "data-open:slide-in-from-left data-closed:slide-out-to-left inset-y-0 left-0 h-full w-[min(85vw,20rem)] border-r",
      side === "top" &&
        "data-open:slide-in-from-top data-closed:slide-out-to-top inset-x-0 top-0 h-auto max-h-[85vh] border-b",
      side === "bottom" &&
        "data-open:slide-in-from-bottom data-closed:slide-out-to-bottom inset-x-0 bottom-0 h-auto max-h-[85vh] border-t",
      swipeEnabled && "touch-pan-y [&_*]:touch-pan-y",
      swiping && "transition-none will-change-[translate]",
      settling && "transition-[translate] ease-out",
      className,
    )}
    style={swipeTranslate === undefined
      ? styleProp
      : `${styleProp ? `${styleProp};` : ""}translate:${swipeTranslate}px 0`}
    {...restProps}
  >
    {@render children?.()}
  </DialogPrimitive.Content>
</SheetPortal>
