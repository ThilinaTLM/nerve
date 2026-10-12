export type JumpToEndPlan = {
  /** Instantly land this far (px) above the end before animating, if set. */
  preJumpDistance?: number;
  behavior: "smooth" | "instant";
};

/** Screens of travel animated at most; anything further is skipped instantly. */
const SMOOTH_SCREENS = 2;

/**
 * Plan a "jump to latest" that always feels animated yet never crawls: a
 * smooth scroll across thousands of estimated rows keeps restarting as rows
 * measure, so long distances first snap to one screen above the end.
 */
export function planJumpToEnd(
  distanceFromEnd: number,
  viewportHeight: number,
  reducedMotion: boolean,
): JumpToEndPlan {
  if (reducedMotion) return { behavior: "instant" };
  const screen = Math.max(1, viewportHeight);
  if (distanceFromEnd <= screen * SMOOTH_SCREENS) return { behavior: "smooth" };
  return { preJumpDistance: screen, behavior: "smooth" };
}
