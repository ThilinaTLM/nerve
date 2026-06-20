export type ScrollFollowDecisionInput = {
  atEnd: boolean;
  scrollDelta: number;
  userScrollAwayIntent: boolean;
  scrollbarPointerActive: boolean;
  epsilon?: number;
};

export function shouldDisableFollowForScroll({
  atEnd,
  scrollDelta,
  userScrollAwayIntent,
  scrollbarPointerActive,
  epsilon = 1,
}: ScrollFollowDecisionInput): boolean {
  if (atEnd) return false;
  if (scrollbarPointerActive) return true;
  return userScrollAwayIntent && scrollDelta < -epsilon;
}
