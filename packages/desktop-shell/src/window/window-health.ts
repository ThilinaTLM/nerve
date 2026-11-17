/**
 * Diagnostics for the "window stops painting and ignores input" freeze seen
 * after OS sleep, screen lock, or long idle. It logs power and window
 * lifecycle events, and compares the native window state with what the
 * renderer reports through the preload heartbeat. If a focused window has no
 * rendered frames, that is logged as one episode.
 *
 * A stall that starts after a resume or unlock, before the window has painted
 * again, is also recovered automatically. The tracker first restarts the GPU
 * process. If the window is still stalled, it then recreates the window, like
 * the tray's "Restart UI".
 */

export const RENDERER_HEALTH_CHANNEL = "desktop.window.health";

/** Check cadence; the preload heartbeat uses the same interval. */
export const WINDOW_HEALTH_CHECK_INTERVAL_MS = 5_000;
/** A stall must persist this long before it is logged as an episode. */
const STALL_GRACE_MS = 10_000;
/** No heartbeat for this long counts as a stall in itself. */
const HEARTBEAT_MISSING_MS = 30_000;
/** A check-timer gap this large means the process was paused (sleep, SIGSTOP). */
const PAUSE_GAP_MS = 3 * WINDOW_HEALTH_CHECK_INTERVAL_MS;
/** How long a GPU restart gets to fix a stall before the window is recreated. */
const RECOVERY_ESCALATION_MS = 15_000;

export type PowerEvent = "suspend" | "resume" | "lock-screen" | "unlock-screen";

export type WindowRecoveryStep = "restart-gpu" | "recreate-window";

/** Sent by the preload every heartbeat and on every visibility change. */
export interface RendererHealthReport {
  visibility: string;
  focused: boolean;
  /** How long the current animation-frame probe has been waiting, if any. */
  framePendingMs?: number;
  /** Latency of the last completed animation-frame probe. */
  frameLatencyMs?: number;
}

export interface HealthWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  webContents: {
    isLoading(): boolean;
    isCrashed(): boolean;
  };
}

type Log = (
  level: "info" | "warn",
  component: string,
  message: string,
  data?: { context?: Record<string, unknown>; durationMs?: number },
) => Promise<void> | void;

export interface WindowHealthTrackerOptions {
  window: HealthWindow;
  log: Log;
  now: () => number;
  /** Extra context for stall logs, such as per-process CPU usage. */
  diagnose?: () => Record<string, unknown>;
  /** Runs a recovery step for a stall that started after wake. */
  recover?: (step: WindowRecoveryStep) => void;
}

type StallReason = "renderer-hidden" | "no-frames" | "heartbeat-missing";

export class WindowHealthTracker {
  readonly #window: HealthWindow;
  readonly #log: Log;
  readonly #now: () => number;
  readonly #diagnose: (() => Record<string, unknown>) | undefined;
  readonly #recover: ((step: WindowRecoveryStep) => void) | undefined;
  #lastReport: RendererHealthReport | undefined;
  #lastReportAt: number | undefined;
  #lastPowerEvent: { event: PowerEvent; at: number } | undefined;
  #lastCheckAt: number | undefined;
  #stallSince: number | undefined;
  #stallReason: StallReason | undefined;
  #stallLogged = false;
  /** Set on resume/unlock and cleared once the focused window paints again. */
  #wokeSinceHealthy = false;
  #recovery: { step: WindowRecoveryStep; at: number } | undefined;

  constructor(options: WindowHealthTrackerOptions) {
    this.#window = options.window;
    this.#log = options.log;
    this.#now = options.now;
    this.#diagnose = options.diagnose;
    this.#recover = options.recover;
  }

  powerEvent(event: PowerEvent): void {
    this.#lastPowerEvent = { event, at: this.#now() };
    if (event === "resume" || event === "unlock-screen") {
      this.#wokeSinceHealthy = true;
    }
    this.#emit("info", `System ${event}`);
  }

  windowEvent(event: string): void {
    this.#emit("info", `Window ${event}`);
  }

  rendererReport(report: RendererHealthReport): void {
    const previous = this.#lastReport;
    this.#lastReport = report;
    this.#lastReportAt = this.#now();
    if (previous && previous.visibility !== report.visibility) {
      this.#emit("info", `Renderer became ${report.visibility}`);
    }
  }

  /** A new document loaded; earlier heartbeats describe the old page. */
  rendererReloaded(): void {
    this.#lastReport = undefined;
    this.#lastReportAt = this.#now();
  }

  check(): void {
    const now = this.#now();
    const gap = this.#lastCheckAt === undefined ? 0 : now - this.#lastCheckAt;
    this.#lastCheckAt = now;
    if (gap >= PAUSE_GAP_MS) {
      // Timers did not run (OS sleep or a stopped process). Report it, and
      // restart stall timing because the last heartbeat is now stale.
      this.#emit("info", "Desktop process was paused", { gapMs: gap });
      this.#lastReportAt = now;
      this.#stallSince = undefined;
      return;
    }

    const state = this.#detectStall(now);
    if (state === "unobserved" || state === "healthy") {
      if (this.#stallLogged && this.#stallSince !== undefined) {
        void this.#log("info", "window-health", "Window painting resumed", {
          durationMs: now - this.#stallSince,
          context: {
            recoveryStep: this.#recovery?.step,
            ...this.#snapshot(now),
          },
        });
      }
      this.#stallSince = undefined;
      this.#stallReason = undefined;
      this.#stallLogged = false;
      this.#recovery = undefined;
      if (state === "healthy") this.#wokeSinceHealthy = false;
      return;
    }
    this.#stallSince ??= now;
    this.#stallReason = state;
    if (now - this.#stallSince < STALL_GRACE_MS) return;
    if (!this.#stallLogged) {
      this.#stallLogged = true;
      this.#emit("warn", "Focused window is not painting", {
        diagnostics: this.#diagnose?.(),
      });
    }
    this.#tryRecover(now);
  }

  #tryRecover(now: number): void {
    if (!this.#recover || !this.#wokeSinceHealthy) return;
    const current = this.#recovery;
    let step: WindowRecoveryStep;
    if (!current) step = "restart-gpu";
    else if (
      current.step === "restart-gpu" &&
      now - current.at >= RECOVERY_ESCALATION_MS
    ) {
      step = "recreate-window";
    } else return;
    this.#recovery = { step, at: now };
    this.#emit("warn", "Recovering stalled window", {
      recoveryStep: step,
      diagnostics: current ? this.#diagnose?.() : undefined,
    });
    this.#recover(step);
  }

  /**
   * "unobserved" means painting cannot be judged right now. "healthy" means a
   * focused, visible window is producing frames.
   */
  #detectStall(now: number): StallReason | "unobserved" | "healthy" {
    const window = this.#window;
    if (window.isDestroyed()) return "unobserved";
    // Only a focused window must paint: hidden, minimized, or covered
    // windows can legitimately stop producing frames.
    if (!window.isVisible() || window.isMinimized() || !window.isFocused()) {
      return "unobserved";
    }
    if (window.webContents.isLoading()) return "unobserved";
    const reportAge =
      this.#lastReportAt === undefined ? 0 : now - this.#lastReportAt;
    if (reportAge >= HEARTBEAT_MISSING_MS) return "heartbeat-missing";
    const report = this.#lastReport;
    if (!report) return "unobserved";
    if (report.visibility !== "visible") return "renderer-hidden";
    if ((report.framePendingMs ?? 0) >= WINDOW_HEALTH_CHECK_INTERVAL_MS) {
      return "no-frames";
    }
    return "healthy";
  }

  #emit(
    level: "info" | "warn",
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    void this.#log(level, "window-health", message, {
      context: { ...extra, ...this.#snapshot(this.#now()) },
    });
  }

  #snapshot(now: number): Record<string, unknown> {
    const window = this.#window;
    const destroyed = window.isDestroyed();
    return {
      window: destroyed
        ? { destroyed: true }
        : {
            visible: window.isVisible(),
            minimized: window.isMinimized(),
            focused: window.isFocused(),
            loading: window.webContents.isLoading(),
            crashed: window.webContents.isCrashed(),
          },
      renderer: this.#lastReport,
      rendererReportAgeMs:
        this.#lastReportAt === undefined ? undefined : now - this.#lastReportAt,
      stallReason: this.#stallReason,
      lastPowerEvent: this.#lastPowerEvent && {
        event: this.#lastPowerEvent.event,
        agoMs: now - this.#lastPowerEvent.at,
      },
    };
  }
}

export function parseRendererHealthReport(
  value: unknown,
): RendererHealthReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.visibility !== "string") return undefined;
  const optionalNumber = (key: string) =>
    typeof candidate[key] === "number" && Number.isFinite(candidate[key])
      ? Math.round(candidate[key])
      : undefined;
  return {
    visibility: candidate.visibility.slice(0, 32),
    focused: candidate.focused === true,
    framePendingMs: optionalNumber("framePendingMs"),
    frameLatencyMs: optionalNumber("frameLatencyMs"),
  };
}

const WINDOW_EVENTS = ["show", "hide", "minimize", "restore"] as const;
const POWER_EVENTS: readonly PowerEvent[] = [
  "suspend",
  "resume",
  "lock-screen",
  "unlock-screen",
];

type Emitter = Pick<NodeJS.EventEmitter, "on" | "removeListener">;
type Listener = Parameters<Emitter["on"]>[1];

export interface WindowHealthMonitorDependencies {
  window: HealthWindow &
    Emitter & { webContents: HealthWindow["webContents"] & Emitter };
  powerMonitor: Emitter;
  ipcMain: Emitter;
  log: Log;
  now?: () => number;
  diagnose?: () => Record<string, unknown>;
  recover?: (step: WindowRecoveryStep) => void;
}

/** Wires the tracker to Electron; stops itself when the window closes. */
export function installWindowHealthMonitor(
  dependencies: WindowHealthMonitorDependencies,
): () => void {
  const { window, powerMonitor, ipcMain } = dependencies;
  const tracker = new WindowHealthTracker({
    window,
    log: dependencies.log,
    now: dependencies.now ?? Date.now,
    diagnose: dependencies.diagnose,
    recover: dependencies.recover,
  });
  const disposers: Array<() => void> = [];
  const listen = (emitter: Emitter, event: string, listener: Listener) => {
    emitter.on(event, listener);
    disposers.push(() => emitter.removeListener(event, listener));
  };

  for (const event of POWER_EVENTS) {
    listen(powerMonitor, event, () => tracker.powerEvent(event));
  }
  for (const event of WINDOW_EVENTS) {
    listen(window, event, () => tracker.windowEvent(event));
  }
  listen(window.webContents, "did-finish-load", () => {
    tracker.rendererReloaded();
    tracker.windowEvent("loaded");
  });
  listen(
    ipcMain,
    RENDERER_HEALTH_CHANNEL,
    (event: { sender: unknown }, value: unknown) => {
      if (event.sender !== window.webContents) return;
      const report = parseRendererHealthReport(value);
      if (report) tracker.rendererReport(report);
    },
  );

  const interval = setInterval(
    () => tracker.check(),
    WINDOW_HEALTH_CHECK_INTERVAL_MS,
  );
  interval.unref?.();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(interval);
    for (const disposer of disposers.splice(0)) disposer();
  };
  window.on("closed", dispose);
  return dispose;
}
