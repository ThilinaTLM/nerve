import { subscribeClock } from "./clock-ticker";

/**
 * Reactive `now` (epoch ms) that ticks while `intervalMs()` returns a positive
 * number and stays still otherwise. Call during component initialisation.
 */
export function createClock(intervalMs: () => number | undefined): {
  readonly now: number;
} {
  let now = $state(Date.now());
  $effect(() => {
    const interval = intervalMs();
    if (!interval || interval <= 0) return;
    now = Date.now();
    return subscribeClock(interval, (nowMs) => (now = nowMs));
  });
  return {
    get now() {
      return now;
    },
  };
}
