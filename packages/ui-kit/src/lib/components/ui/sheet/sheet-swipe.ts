export type SheetSwipeSide = "left" | "right";

export const SHEET_SWIPE_INTENT_DISTANCE = 8;
export const SHEET_SWIPE_AXIS_DOMINANCE = 1.2;
export const SHEET_SWIPE_DISMISS_RATIO = 0.3;
export const SHEET_SWIPE_DISMISS_VELOCITY = 0.5;

function sideDirection(side: SheetSwipeSide): -1 | 1 {
  return side === "left" ? -1 : 1;
}

export function outwardSheetSwipeDistance(
  side: SheetSwipeSide,
  deltaX: number,
): number {
  if (!Number.isFinite(deltaX)) return 0;
  return Math.max(0, deltaX * sideDirection(side));
}

export function sheetSwipeTranslation(
  side: SheetSwipeSide,
  deltaX: number,
): number {
  const distance = outwardSheetSwipeDistance(side, deltaX);
  return distance === 0 ? 0 : distance * sideDirection(side);
}

export function shouldDismissSheetSwipe({
  distance,
  width,
  velocity,
}: {
  distance: number;
  width: number;
  velocity: number;
}): boolean {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(width) ||
    !Number.isFinite(velocity) ||
    distance <= 0 ||
    width <= 0
  ) {
    return false;
  }

  return (
    distance >= width * SHEET_SWIPE_DISMISS_RATIO ||
    velocity >= SHEET_SWIPE_DISMISS_VELOCITY
  );
}
