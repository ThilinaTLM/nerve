export type SheetSwipeSide = "left" | "right" | "bottom";

export const SHEET_SWIPE_INTENT_DISTANCE = 8;
export const SHEET_SWIPE_AXIS_DOMINANCE = 1.2;
export const SHEET_SWIPE_DISMISS_RATIO = 0.3;
export const SHEET_SWIPE_DISMISS_VELOCITY = 0.5;

/** Side sheets swipe horizontally; a bottom sheet is pulled down. */
export function sheetSwipeAxis(side: SheetSwipeSide): "x" | "y" {
  return side === "bottom" ? "y" : "x";
}

function sideDirection(side: SheetSwipeSide): -1 | 1 {
  return side === "left" ? -1 : 1;
}

/** Distance moved toward the sheet's own edge; `delta` is along its axis. */
export function outwardSheetSwipeDistance(
  side: SheetSwipeSide,
  delta: number,
): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(0, delta * sideDirection(side));
}

export function sheetSwipeTranslation(
  side: SheetSwipeSide,
  delta: number,
): number {
  const distance = outwardSheetSwipeDistance(side, delta);
  return distance === 0 ? 0 : distance * sideDirection(side);
}

/** The off-screen translation a dismissed sheet settles at. */
export function sheetSwipeDismissTranslation(
  side: SheetSwipeSide,
  size: number,
): number {
  return sideDirection(side) * size;
}

export function shouldDismissSheetSwipe({
  distance,
  size,
  velocity,
}: {
  distance: number;
  /** The sheet's extent along the swipe axis. */
  size: number;
  velocity: number;
}): boolean {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(size) ||
    !Number.isFinite(velocity) ||
    distance <= 0 ||
    size <= 0
  ) {
    return false;
  }

  return (
    distance >= size * SHEET_SWIPE_DISMISS_RATIO ||
    velocity >= SHEET_SWIPE_DISMISS_VELOCITY
  );
}
