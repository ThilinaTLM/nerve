import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { installDaemonPerformanceMonitor } from "../src/infrastructure/diagnostics/performance-monitor.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("daemon performance monitor", () => {
  it("is inert unless explicitly enabled", () => {
    let reads = 0;
    const monitor = installDaemonPerformanceMonitor({
      enabled: false,
      dataDir: "/tmp/ignored",
      getCounts: () => {
        reads += 1;
        return {};
      },
    });
    monitor.stop();
    assert.equal(reads, 0);
  });

  it("records CPU deltas, memory, handles, requests, and counts", async () => {
    const cpu = [
      { user: 100_000, system: 20_000 },
      { user: 130_000, system: 30_000 },
      { user: 160_000, system: 40_000 },
    ];
    const times = [1_000, 2_000, 3_000];
    const lines: string[] = [];
    let scheduled: (() => void) | undefined;
    let clears = 0;
    const monitor = installDaemonPerformanceMonitor({
      enabled: true,
      dataDir: "/safe/home",
      getCounts: () => ({ projects: 4, activeRuns: 2 }),
      cpuUsage: () => cpu.shift() ?? { user: 160_000, system: 40_000 },
      monotonicNowMs: () => times.shift() ?? 3_000,
      memoryUsage: () => ({
        rss: 100,
        heapTotal: 80,
        heapUsed: 60,
        external: 20,
        arrayBuffers: 10,
      }),
      uptime: () => 12.5,
      activeHandles: () => 7,
      activeRequests: () => 3,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
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
        clears += 1;
      }) as never,
    });

    await tick();
    scheduled?.();
    await tick();
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(lines.length, 2);
    assert.equal(first.cpuPercent, 4);
    assert.equal(first.rssBytes, 100);
    assert.equal(first.heapUsedBytes, 60);
    assert.equal(first.activeHandles, 7);
    assert.equal(first.activeRequests, 3);
    assert.deepEqual(first.counts, { projects: 4, activeRuns: 2 });
    assert.equal("argv" in first, false);
    monitor.stop();
    monitor.stop();
    assert.equal(clears, 1);
  });

  it("skips overlapping appends and warns only once", async () => {
    let scheduled: (() => void) | undefined;
    let rejectWrite!: (error: Error) => void;
    let writes = 0;
    let warnings = 0;
    const monitor = installDaemonPerformanceMonitor({
      enabled: true,
      dataDir: "/safe/home",
      getCounts: () => ({}),
      append: () => {
        writes += 1;
        return new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
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
    rejectWrite(new Error("disk full"));
    await tick();
    scheduled?.();
    assert.equal(writes, 2);
    rejectWrite(new Error("still full"));
    await tick();
    assert.equal(warnings, 1);
    monitor.stop();
  });
});
