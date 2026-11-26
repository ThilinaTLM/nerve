import { flush } from "./wait.js";

export interface ManualTimerCore {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, everyMs: number): number;
  clearInterval(handle: unknown): void;
  /** Number of armed timers and intervals. */
  pending(): number;
  /** Moves time forward, firing due timers in time order (ties by creation), settling I/O after each. */
  advance(ms: number): Promise<void>;
}

interface Timer {
  at: number;
  every?: number;
  callback: () => void;
}

/**
 * Ordered fake timers. Port-shaped fakes (`ProtocolTimers`, `PollClock`, ...)
 * are thin adapters over this core and stay with their owners.
 */
export function createManualTimerCore(start = 0): ManualTimerCore {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const clear = (handle: unknown) => void timers.delete(handle as number);
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout: clear,
    setInterval(callback, everyMs) {
      const id = nextId++;
      const every = Math.max(1, everyMs);
      timers.set(id, { at: now + every, every, callback });
      return id;
    },
    clearInterval: clear,
    pending: () => timers.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let due:
          | [number, typeof timers extends Map<number, infer V> ? V : never]
          | undefined;
        for (const entry of timers)
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at))
            due = entry;
        if (!due) break;
        const [id, timer] = due;
        now = Math.max(now, timer.at);
        if (timer.every === undefined) timers.delete(id);
        else timer.at += timer.every;
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}
