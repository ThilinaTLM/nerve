import { clientLog } from "$lib/platform/logging/client-logger";

export interface PollClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Page-visibility source; `listen` reports focus/online/visibility changes. */
export interface PollEnvironment {
  isVisible(): boolean;
  listen(onChange: () => void): () => void;
}

export interface PollOptions {
  run(signal: AbortSignal): unknown;
  /** `undefined`/`0` pauses the poll (no ticks, no wake runs). */
  intervalMs: number | (() => number | undefined);
  /** Only tick while true; call `reschedule()` after it turns true. */
  enabled?: () => boolean;
  /** Pause while the document is hidden; run if stale on visible/focus/online. Default true. */
  whileVisible?: boolean;
  /** Minimum gap between wake-triggered runs. Defaults to the interval. */
  minGapMs?: number;
  /** Run once on `start()`. */
  immediate?: boolean;
  onError?(error: unknown): void;
  clock?: PollClock;
  environment?: PollEnvironment;
}

export interface Poll {
  start(): void;
  stop(): void;
  /** Runs now regardless of visibility or gap; coalesces into one follow-up if a run is in flight. */
  trigger(): Promise<void>;
  /** Re-arms the timer from now (e.g. after `enabled` changed). No-op during a run. */
  reschedule(): void;
  readonly running: boolean;
}

const systemClock: PollClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function browserPollEnvironment(
  targetWindow: Pick<
    Window,
    "addEventListener" | "removeEventListener"
  > = window,
  targetDocument: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  > = document,
): PollEnvironment {
  return {
    isVisible: () => targetDocument.visibilityState === "visible",
    listen(onChange) {
      targetWindow.addEventListener("focus", onChange);
      targetWindow.addEventListener("online", onChange);
      targetDocument.addEventListener("visibilitychange", onChange);
      return () => {
        targetWindow.removeEventListener("focus", onChange);
        targetWindow.removeEventListener("online", onChange);
        targetDocument.removeEventListener("visibilitychange", onChange);
      };
    },
  };
}

const alwaysVisible: PollEnvironment = {
  isVisible: () => true,
  listen: () => () => undefined,
};

function defaultEnvironment(): PollEnvironment {
  return typeof document === "undefined" || typeof window === "undefined"
    ? alwaysVisible
    : browserPollEnvironment();
}

export function createPoll(options: PollOptions): Poll {
  const clock = options.clock ?? systemClock;
  const whileVisible = options.whileVisible ?? true;
  const environment = whileVisible
    ? (options.environment ?? defaultEnvironment())
    : alwaysVisible;
  const onError =
    options.onError ??
    ((error: unknown) =>
      clientLog("warn", "polling", "Poll run failed", { error }));

  let running = false;
  let timer: unknown;
  let session = 0;
  let abort: AbortController | undefined;
  let stopListening: (() => void) | undefined;
  let inFlight: Promise<void> | undefined;
  let followUp = false;
  let lastRunAt = Number.NEGATIVE_INFINITY;

  const interval = (): number => {
    const value =
      typeof options.intervalMs === "function"
        ? options.intervalMs()
        : options.intervalMs;
    return value && value > 0 ? value : 0;
  };
  const enabled = (): boolean => options.enabled?.() ?? true;
  const visible = (): boolean => !whileVisible || environment.isVisible();

  const clearTimer = (): void => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };

  const arm = (): void => {
    clearTimer();
    const delay = interval();
    if (!running || inFlight || !delay || !visible() || !enabled()) return;
    const armedSession = session;
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (armedSession !== session || !running) return;
      if (!visible() || !enabled() || !interval()) return;
      void execute();
    }, delay);
  };

  const execute = (): Promise<void> => {
    if (inFlight) {
      followUp = true;
      return inFlight;
    }
    clearTimer();
    const signal = (abort ??= new AbortController()).signal;
    lastRunAt = clock.now();
    inFlight = (async () => {
      try {
        await options.run(signal);
      } catch (error) {
        if (!signal.aborted) onError(error);
      }
    })().finally(() => {
      inFlight = undefined;
      if (!running) return;
      if (followUp) {
        followUp = false;
        void execute();
      } else arm();
    });
    return inFlight;
  };

  const wake = (): void => {
    if (!running) return;
    if (!visible()) {
      clearTimer();
      return;
    }
    if (inFlight || !interval() || !enabled()) return;
    const gap = options.minGapMs ?? interval();
    if (clock.now() - lastRunAt >= gap) void execute();
    else if (timer === undefined) arm();
  };

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      session += 1;
      abort = new AbortController();
      followUp = false;
      if (whileVisible) stopListening = environment.listen(wake);
      if (options.immediate && enabled()) void execute();
      else arm();
    },
    stop() {
      if (!running) return;
      running = false;
      session += 1;
      followUp = false;
      clearTimer();
      stopListening?.();
      stopListening = undefined;
      abort?.abort();
      abort = undefined;
    },
    trigger() {
      return execute();
    },
    reschedule() {
      if (running) arm();
    },
  };
}
