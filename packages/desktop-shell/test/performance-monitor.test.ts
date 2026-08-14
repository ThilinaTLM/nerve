import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { installDesktopPerformanceMonitor } from "../src/performance/performance-monitor.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("desktop performance monitor", () => {
  it("does nothing when diagnostics are disabled", () => {
    let intervals = 0;
    const monitor = installDesktopPerformanceMonitor({
      enabled: false,
      dataDir: "/tmp/ignored",
      getMetrics: () => {
        assert.fail("metrics should not be read");
      },
      getWindowState: () => undefined,
      setInterval: (() => {
        intervals += 1;
      }) as never,
    });

    monitor.stop();
    assert.equal(intervals, 0);
  });

  it("writes content-free process metrics immediately and periodically", async () => {
    const lines: string[] = [];
    let scheduled: (() => void) | undefined;
    let cleared = 0;
    const monitor = installDesktopPerformanceMonitor({
      enabled: true,
      dataDir: "/safe/home",
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      getMetrics: () => [
        {
          pid: 42,
          type: "Tab",
          cpu: { percentCPUUsage: 12.5, idleWakeupsPerSecond: 3 },
          memory: { workingSetSize: 100, privateBytes: 60, sharedBytes: 40 },
        },
      ],
      getWindowState: () => ({ visible: true, minimized: false }),
      append: async (path, line) => {
        assert.equal(path, join("/safe/home", "logs", "performance.jsonl"));
        lines.push(line);
      },
      setInterval: ((callback: () => void, delay: number) => {
        assert.equal(delay, 10_000);
        scheduled = callback;
        return { unref() {} };
      }) as never,
      clearInterval: (() => {
        cleared += 1;
      }) as never,
    });

    await tick();
    scheduled?.();
    await tick();
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(lines.length, 2);
    assert.deepEqual(record, {
      type: "nerve.performance",
      source: "desktop",
      ts: "2026-08-14T00:00:00.000Z",
      window: { visible: true, minimized: false },
      processes: [
        {
          pid: 42,
          role: "Tab",
          cpuPercent: 12.5,
          idleWakeupsPerSecond: 3,
          rssBytes: 102_400,
          privateBytes: 61_440,
          sharedBytes: 40_960,
        },
      ],
    });
    monitor.stop();
    monitor.stop();
    assert.equal(cleared, 1);
  });

  it("skips overlapping writes and isolates append failures", async () => {
    let scheduled: (() => void) | undefined;
    let completeWrite!: () => void;
    let writes = 0;
    let warnings = 0;
    const monitor = installDesktopPerformanceMonitor({
      enabled: true,
      dataDir: "/safe/home",
      getMetrics: () => [],
      getWindowState: () => undefined,
      append: () => {
        writes += 1;
        return new Promise<void>((_resolve, reject) => {
          completeWrite = () => reject(new Error("disk full"));
        });
      },
      warn: () => {
        warnings += 1;
      },
      setInterval: ((callback: () => void) => {
        scheduled = callback;
        return { unref() {} };
      }) as never,
      clearInterval: (() => undefined) as never,
    });

    scheduled?.();
    assert.equal(writes, 1);
    completeWrite();
    await tick();
    scheduled?.();
    assert.equal(writes, 2);
    completeWrite();
    await tick();
    assert.equal(warnings, 1);
    monitor.stop();
  });
});
