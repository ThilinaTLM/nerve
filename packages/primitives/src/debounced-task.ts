/** Timer source; structurally compatible with the app's `PollClock`. */
export interface DebounceClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: DebounceClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DebouncedTask {
  /** (Re)starts the wait; `fn` runs once, `ms` after the last call. */
  schedule(): void;
  /** Runs `fn` now if a run is pending. Returns whether it ran. */
  flush(): boolean;
  /** Drops a pending run. */
  cancel(): void;
  readonly pending: boolean;
}

/**
 * Trailing-edge debounce. `fn` must handle its own errors: they are not
 * caught here, so a rejection from an async `fn` is unhandled.
 */
export function createDebouncedTask(
  fn: () => unknown,
  ms: number,
  clock: DebounceClock = systemClock,
): DebouncedTask {
  let handle: unknown;
  let pending = false;
  const clear = () => {
    if (pending) clock.clearTimeout(handle);
    pending = false;
    handle = undefined;
  };
  return {
    schedule() {
      clear();
      pending = true;
      handle = clock.setTimeout(() => {
        pending = false;
        handle = undefined;
        fn();
      }, ms);
    },
    flush() {
      if (!pending) return false;
      clear();
      fn();
      return true;
    },
    cancel: clear,
    get pending() {
      return pending;
    },
  };
}
