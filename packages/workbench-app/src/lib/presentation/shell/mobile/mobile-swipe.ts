import type { PanelViewIcon } from "../shell-types.js";

/**
 * Pure gesture math for phone list rows: intent detection, offset clamping and
 * settle decisions. Kept free of DOM and Svelte so it can be unit tested.
 *
 * Offsets are signed pixels of the row surface: positive reveals the leading
 * action (swipe right), negative reveals the trailing actions (swipe left).
 */

/** Movement before the gesture commits to an axis. */
export const SWIPE_INTENT_SLOP = 8;
/** Horizontal travel must beat vertical travel by this factor to count. */
export const SWIPE_INTENT_RATIO = 1.2;
/** Hold time before a press opens the actions sheet. */
export const LONG_PRESS_MS = 500;
/** Finger travel that cancels a pending long-press. */
export const LONG_PRESS_SLOP = 10;
/** Width of one revealed action: wide enough for a 44px+ target and a label. */
export const SWIPE_ACTION_WIDTH = 76;
/** Fraction of the revealed width that commits to opening. */
export const SWIPE_OPEN_FRACTION = 0.4;
/** px/ms flick speed that opens regardless of distance. */
export const SWIPE_FLICK_VELOCITY = 0.5;

export type SwipeIntent = "pending" | "horizontal" | "vertical";
export type SwipeSide = "leading" | "trailing";
export type SwipeWidths = { leading: number; trailing: number };

export function classifySwipeIntent(dx: number, dy: number): SwipeIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_INTENT_SLOP) return "pending";
  return ax > ay * SWIPE_INTENT_RATIO ? "horizontal" : "vertical";
}

export function exceedsLongPressSlop(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LONG_PRESS_SLOP;
}

/** Offset a row rests at once it is open on `side`. */
export function swipeRestOffset(
  side: SwipeSide | undefined,
  widths: SwipeWidths,
): number {
  if (side === "leading") return widths.leading;
  if (side === "trailing") return -widths.trailing;
  return 0;
}

/**
 * Follow the finger, clamped to the revealed actions. Past the edge the row
 * resists a little instead of stopping dead, so the limit feels physical.
 */
export function swipeOffset(
  startOffset: number,
  dx: number,
  widths: SwipeWidths,
): number {
  const raw = startOffset + dx;
  if (raw > widths.leading) {
    return widths.leading + rubberBand(raw - widths.leading, widths.leading);
  }
  if (raw < -widths.trailing) {
    return (
      -widths.trailing - rubberBand(-widths.trailing - raw, widths.trailing)
    );
  }
  return raw;
}

function rubberBand(overshoot: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(overshoot * 0.25, width * 0.2);
}

/**
 * Decide where a released row rests. `velocity` is signed px/ms in the
 * direction of travel (negative = leftwards).
 */
export function settleSwipe(
  offset: number,
  velocity: number,
  widths: SwipeWidths,
): SwipeSide | undefined {
  if (widths.leading > 0 && offset > 0) {
    if (velocity >= SWIPE_FLICK_VELOCITY) return "leading";
    if (velocity <= -SWIPE_FLICK_VELOCITY) return undefined;
    if (offset >= widths.leading * SWIPE_OPEN_FRACTION) return "leading";
  }
  if (widths.trailing > 0 && offset < 0) {
    if (velocity <= -SWIPE_FLICK_VELOCITY) return "trailing";
    if (velocity >= SWIPE_FLICK_VELOCITY) return undefined;
    if (-offset >= widths.trailing * SWIPE_OPEN_FRACTION) return "trailing";
  }
  return undefined;
}

/** Revealed width for a number of actions (trailing allows at most two). */
export function swipeWidth(actionCount: number, max = 2): number {
  return Math.min(Math.max(actionCount, 0), max) * SWIPE_ACTION_WIDTH;
}

export type MobileRowSwipeAction = {
  label: string;
  icon?: PanelViewIcon;
  /** Fill colour; omit for a neutral action. `destructive` is the solid red. */
  tone?: "success" | "info" | "destructive";
  onSelect: () => void;
};
