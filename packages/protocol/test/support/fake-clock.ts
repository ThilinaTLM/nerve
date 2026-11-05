import type { ProtocolClock, ProtocolTimers } from "../../src/runtime/ports.js";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Manual clock plus timers. `advance` fires due timeouts in order, then settles microtasks. */
export function createFakeClock(start = 0) {
  let now = start;
  const timeouts = new Map<symbol, { at: number; callback: () => void }>();
  const clock: ProtocolClock = {
    now: () => now,
    isoNow: () => new Date(now).toISOString(),
  };
  const timers: ProtocolTimers = {
    setTimeout: (callback, delay) => {
      const key = Symbol();
      timeouts.set(key, { at: now + delay, callback });
      return key;
    },
    clearTimeout: (key) => {
      timeouts.delete(key as symbol);
    },
    setInterval: () => {
      throw new Error("Unexpected interval");
    },
    clearInterval: () => {},
  };
  return {
    clock,
    timers,
    timeouts,
    now: () => now,
    advance: async (ms: number) => {
      now += ms;
      for (const [key, timer] of [...timeouts].sort(
        (a, b) => a[1].at - b[1].at,
      ))
        if (timer.at <= now) {
          timeouts.delete(key);
          timer.callback();
        }
      await settle();
    },
  };
}

export { settle };
