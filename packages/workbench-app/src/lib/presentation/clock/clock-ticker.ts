type Listener = (nowMs: number) => void;
type Ticker = {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval>;
};

const tickers = new Map<number, Ticker>();

/**
 * Subscribes to a wall-clock tick. Subscribers with the same interval share one
 * ref-counted timer, which is cleared when the last one unsubscribes.
 */
export function subscribeClock(
  intervalMs: number,
  listener: Listener,
): () => void {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    const listeners = new Set<Listener>();
    ticker = {
      listeners,
      timer: setInterval(() => {
        const nowMs = Date.now();
        for (const notify of [...listeners]) notify(nowMs);
      }, intervalMs),
    };
    tickers.set(intervalMs, ticker);
  }
  const owner = ticker;
  owner.listeners.add(listener);
  return () => {
    if (!owner.listeners.delete(listener) || owner.listeners.size > 0) return;
    clearInterval(owner.timer);
    tickers.delete(intervalMs);
  };
}
