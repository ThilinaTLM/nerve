import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  RENDERER_HEALTH_CHANNEL,
  WindowHealthTracker,
  parseRendererHealthReport,
  type HealthWindow,
} from "../src/window/window-health.js";

const require = createRequire(import.meta.url);
const { installRendererHealthReporter } = require("../src/preload-api.cjs") as {
  installRendererHealthReporter(options: {
    ipcRenderer: { send(channel: string, value: unknown): void };
    document: {
      visibilityState: string;
      hasFocus(): boolean;
      addEventListener(event: string, listener: () => void): void;
    };
    requestAnimationFrame(callback: () => void): void;
    setInterval(callback: () => void, delayMs: number): void;
    now(): number;
  }): void;
};

function harness() {
  let now = 0;
  const state = { visible: true, minimized: false, focused: true };
  const window: HealthWindow = {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    isFocused: () => state.focused,
    webContents: { isLoading: () => false, isCrashed: () => false },
  };
  const logs: Array<{ level: string; message: string; context?: unknown }> = [];
  const tracker = new WindowHealthTracker({
    window,
    now: () => now,
    log: (level, _component, message, data) => {
      logs.push({ level, message, context: data?.context });
    },
  });
  const advance = (ms: number) => {
    // Checks run every 5s, like the real interval.
    for (let elapsed = 0; elapsed < ms; elapsed += 5_000) {
      now += 5_000;
      tracker.check();
    }
  };
  /** One check after a long timer gap, as after OS sleep. */
  const jump = (ms: number) => {
    now += ms;
    tracker.check();
  };
  return { tracker, state, logs, advance, jump };
}

const stallReason = (log: { context?: unknown } | undefined) =>
  (log?.context as { stallReason?: string } | undefined)?.stallReason;

describe("window health tracker", () => {
  it("logs one episode when a focused window's renderer stays hidden", () => {
    const { tracker, logs, advance } = harness();
    tracker.check();
    tracker.rendererReport({ visibility: "visible", focused: true });
    tracker.powerEvent("resume");
    tracker.rendererReport({ visibility: "hidden", focused: false });
    advance(5_000);
    assert.equal(logs.filter((log) => log.level === "warn").length, 0);
    advance(10_000);
    tracker.rendererReport({ visibility: "hidden", focused: false });
    advance(20_000);

    const warnings = logs.filter((log) => log.level === "warn");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.message, "Focused window is not painting");
    assert.equal(stallReason(warnings[0]), "renderer-hidden");

    tracker.rendererReport({ visibility: "visible", focused: true });
    advance(5_000);
    assert.equal(logs.at(-1)?.message, "Window painting resumed");
  });

  it("does not treat an unfocused or minimized window as stalled", () => {
    const { tracker, state, logs, advance } = harness();
    tracker.check();
    tracker.rendererReport({
      visibility: "hidden",
      focused: false,
      framePendingMs: 60_000,
    });
    state.focused = false;
    advance(60_000);
    state.focused = true;
    state.minimized = true;
    advance(60_000);
    assert.equal(logs.filter((log) => log.level === "warn").length, 0);
  });

  it("flags missing frames and missing heartbeats", () => {
    const frames = harness();
    frames.tracker.check();
    frames.tracker.rendererReport({
      visibility: "visible",
      focused: true,
      framePendingMs: 5_000,
    });
    frames.advance(15_000);
    assert.equal(stallReason(frames.logs.at(-1)), "no-frames");

    const silent = harness();
    silent.tracker.check();
    silent.tracker.rendererReport({ visibility: "visible", focused: true });
    silent.advance(45_000);
    assert.equal(stallReason(silent.logs.at(-1)), "heartbeat-missing");
  });

  it("reports a paused process instead of a stall after a timer gap", () => {
    const { tracker, logs, jump } = harness();
    tracker.check();
    tracker.rendererReport({ visibility: "visible", focused: true });
    jump(600_000);
    assert.equal(logs.at(-1)?.message, "Desktop process was paused");
    assert.equal((logs.at(-1)?.context as { gapMs?: number }).gapMs, 600_000);
    assert.equal(logs.filter((log) => log.level === "warn").length, 0);
  });

  it("sanitizes renderer reports", () => {
    assert.equal(parseRendererHealthReport(null), undefined);
    assert.equal(parseRendererHealthReport({ focused: true }), undefined);
    assert.deepEqual(
      parseRendererHealthReport({
        visibility: "visible",
        focused: "yes",
        framePendingMs: 12.6,
        frameLatencyMs: Number.NaN,
      }),
      {
        visibility: "visible",
        focused: false,
        framePendingMs: 13,
        frameLatencyMs: undefined,
      },
    );
  });
});

describe("renderer health reporter", () => {
  it("reports visibility changes and pending animation-frame probes", () => {
    const sent: unknown[] = [];
    let tick: (() => void) | undefined;
    let visibilityListener: (() => void) | undefined;
    const frames: Array<() => void> = [];
    let now = 0;
    const document = {
      visibilityState: "visible",
      hasFocus: () => true,
      addEventListener: (_event: string, listener: () => void) => {
        visibilityListener = listener;
      },
    };
    installRendererHealthReporter({
      ipcRenderer: {
        send: (channel, value) => {
          assert.equal(channel, RENDERER_HEALTH_CHANNEL);
          sent.push(value);
        },
      },
      document,
      requestAnimationFrame: (callback) => frames.push(callback),
      setInterval: (callback) => {
        tick = callback;
      },
      now: () => now,
    });

    now = 16;
    frames.shift()?.();
    now = 5_000;
    tick?.();
    assert.deepEqual(sent.at(-1), {
      visibility: "visible",
      focused: true,
      framePendingMs: undefined,
      frameLatencyMs: 16,
    });

    // The probe started on that tick never gets a frame.
    now = 10_000;
    tick?.();
    assert.equal(
      (sent.at(-1) as { framePendingMs?: number }).framePendingMs,
      5_000,
    );

    document.visibilityState = "hidden";
    visibilityListener?.();
    assert.equal((sent.at(-1) as { visibility: string }).visibility, "hidden");
  });
});
