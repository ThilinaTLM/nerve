import { createManualTimerCore, flush } from "@nervekit/test-kit";
import type { ProtocolClock, ProtocolTimers } from "../../src/runtime/ports.js";

/** `ProtocolTimers` over a manual timer core. Intervals are allowed only when asked for. */
export function protocolTimersOf(
  core: ReturnType<typeof createManualTimerCore>,
  options: { intervals?: boolean } = {},
): ProtocolTimers {
  return {
    setTimeout: (callback, delay) => core.setTimeout(callback, delay),
    clearTimeout: (handle) => core.clearTimeout(handle),
    setInterval: (callback, every) => {
      if (!options.intervals) throw new Error("Unexpected interval");
      return core.setInterval(callback, every);
    },
    clearInterval: (handle) => core.clearInterval(handle),
  };
}

/** Manual clock plus timers. `advance` fires due timeouts in order, then settles microtasks. */
export function createFakeClock(
  start = 0,
  options: { intervals?: boolean } = {},
) {
  const core = createManualTimerCore(start);
  const clock: ProtocolClock = {
    now: () => core.now(),
    isoNow: () => new Date(core.now()).toISOString(),
  };
  return {
    clock,
    timers: protocolTimersOf(core, options),
    /** Armed timers; `size` mirrors the old map the tests asserted on. */
    timeouts: {
      get size() {
        return core.pending();
      },
    },
    now: core.now,
    advance: core.advance,
  };
}

export { flush as settle };
