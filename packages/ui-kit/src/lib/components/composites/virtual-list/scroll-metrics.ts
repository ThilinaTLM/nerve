/**
 * Frame-scoped cache for the viewport's maximum scroll offset
 * (`scrollHeight - clientHeight`). Each read can force a synchronous layout
 * when the DOM changed, and streaming follow reads it from several places per
 * frame. The cached value lives until the next animation frame or an explicit
 * `invalidate()` (call it when layout is known to change: row resize, spacer
 * height change).
 */
export type ScrollMetrics = {
  maxScrollOffset(): number;
  invalidate(): void;
  dispose(): void;
};

export function createScrollMetrics(
  read: () => number,
  requestFrame: (callback: () => void) => number = (callback) =>
    requestAnimationFrame(callback),
  cancelFrame: (handle: number) => void = (handle) =>
    cancelAnimationFrame(handle),
): ScrollMetrics {
  let cached: number | undefined;
  let frame: number | undefined;

  function invalidate() {
    cached = undefined;
    if (frame !== undefined) {
      cancelFrame(frame);
      frame = undefined;
    }
  }

  return {
    maxScrollOffset() {
      if (cached !== undefined) return cached;
      cached = read();
      frame ??= requestFrame(() => {
        frame = undefined;
        cached = undefined;
      });
      return cached;
    },
    invalidate,
    dispose: invalidate,
  };
}

/** Distance (px) from the current offset to the end, never negative. */
export function distanceFromEnd(
  maxScrollOffset: number,
  scrollOffset: number,
): number {
  return Math.max(maxScrollOffset - scrollOffset, 0);
}
