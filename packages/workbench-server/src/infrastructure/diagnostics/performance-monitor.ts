import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  monitorEventLoopDelay,
  performance as nodePerformance,
} from "node:perf_hooks";
import type { PerformanceMetricsSnapshot } from "../../core/ports/diagnostics.js";

const SAMPLE_INTERVAL_MS = 10_000;

type IntervalHandle = ReturnType<typeof setInterval>;
type CpuUsage = { user: number; system: number };
type MemoryUsage = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};
type EventLoopUtilization = {
  utilization: number;
  idle: number;
  active: number;
};
type EventLoopDelayMonitor = {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
  readonly max: number;
};

export type DaemonPerformanceCounts = Record<string, number>;

type DaemonPerformanceMonitorOptions = {
  enabled: boolean;
  dataDir: string;
  sessionId?: string;
  pid?: number;
  getCounts: () => DaemonPerformanceCounts;
  getActivity?: () => PerformanceMetricsSnapshot;
  cpuUsage?: () => CpuUsage;
  memoryUsage?: () => MemoryUsage;
  uptime?: () => number;
  activeHandles?: () => number;
  activeRequests?: () => number;
  now?: () => Date;
  monotonicNowMs?: () => number;
  eventLoopUtilization?: (
    current?: EventLoopUtilization,
    previous?: EventLoopUtilization,
  ) => EventLoopUtilization;
  eventLoopDelay?: EventLoopDelayMonitor;
  append?: (path: string, line: string) => Promise<void>;
  setInterval?: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  warn?: (error: unknown) => void;
};

export type DaemonPerformanceMonitor = { stop: () => void };

async function appendJsonLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, "utf8");
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function performanceLogFilename(
  sessionId: string | undefined,
  source: "daemon",
  now: Date,
  pid: number,
): string {
  const safeSessionId = SAFE_SESSION_ID.test(sessionId ?? "")
    ? sessionId
    : `${now.toISOString().replace(/[-:.]/g, "")}-${source}-${Math.max(0, Math.trunc(pid))}`;
  return `performance-${safeSessionId}.jsonl`;
}

function defaultActiveHandles(): number {
  const runtime = process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
  };
  return runtime._getActiveHandles?.().length ?? 0;
}

function defaultActiveRequests(): number {
  const runtime = process as NodeJS.Process & {
    _getActiveRequests?: () => unknown[];
  };
  return runtime._getActiveRequests?.().length ?? 0;
}

export function installDaemonPerformanceMonitor(
  options: DaemonPerformanceMonitorOptions,
): DaemonPerformanceMonitor {
  if (!options.enabled) return { stop: () => undefined };

  const cpuUsage = options.cpuUsage ?? (() => process.cpuUsage());
  const memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
  const uptime = options.uptime ?? (() => process.uptime());
  const activeHandles = options.activeHandles ?? defaultActiveHandles;
  const activeRequests = options.activeRequests ?? defaultActiveRequests;
  const now = options.now ?? (() => new Date());
  const monotonicNowMs = options.monotonicNowMs ?? (() => performance.now());
  const eventLoopUtilization =
    options.eventLoopUtilization ??
    ((current?: EventLoopUtilization, previous?: EventLoopUtilization) =>
      nodePerformance.eventLoopUtilization(current, previous));
  const eventLoopDelay =
    options.eventLoopDelay ?? monitorEventLoopDelay({ resolution: 20 });
  const append = options.append ?? appendJsonLine;
  const createInterval = options.setInterval ?? setInterval;
  const destroyInterval = options.clearInterval ?? clearInterval;
  const path = join(
    options.dataDir,
    "logs",
    performanceLogFilename(
      options.sessionId,
      "daemon",
      now(),
      options.pid ?? process.pid,
    ),
  );
  let previousCpu = cpuUsage();
  let previousAtMs = monotonicNowMs();
  let previousEventLoop = eventLoopUtilization();
  let stopped = false;
  let writing = false;
  let warned = false;
  eventLoopDelay.enable();

  const sample = () => {
    if (stopped || writing) return;
    const currentCpu = cpuUsage();
    const currentAtMs = monotonicNowMs();
    const sampleWindowMs = Math.max(0, currentAtMs - previousAtMs);
    const elapsedMicros = sampleWindowMs * 1000;
    const consumedMicros =
      currentCpu.user +
      currentCpu.system -
      previousCpu.user -
      previousCpu.system;
    previousCpu = currentCpu;
    previousAtMs = currentAtMs;
    const currentEventLoop = eventLoopUtilization();
    const eventLoop = eventLoopUtilization(currentEventLoop, previousEventLoop);
    previousEventLoop = currentEventLoop;
    const delay = {
      medianMs: nanosecondsToMs(eventLoopDelay.percentile(50)),
      p95Ms: nanosecondsToMs(eventLoopDelay.percentile(95)),
      maxMs: nanosecondsToMs(eventLoopDelay.max),
    };
    eventLoopDelay.reset();
    const memory = memoryUsage();
    writing = true;
    const record = {
      type: "nerve.performance",
      source: "daemon",
      ts: now().toISOString(),
      pid: process.pid,
      uptimeMs: Math.round(uptime() * 1000),
      sampleWindowMs,
      cpuPercent:
        elapsedMicros > 0
          ? Math.max(0, (consumedMicros / elapsedMicros) * 100)
          : undefined,
      eventLoopUtilization: finiteOrUndefined(eventLoop.utilization),
      eventLoopDelayMs: delay,
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      activeHandles: activeHandles(),
      activeRequests: activeRequests(),
      counts: options.getCounts(),
      activity: options.getActivity?.(),
    };
    void append(path, `${JSON.stringify(record)}\n`)
      .catch((error) => {
        if (warned) return;
        warned = true;
        options.warn?.(error);
      })
      .finally(() => {
        writing = false;
      });
  };

  sample();
  const interval = createInterval(sample, SAMPLE_INTERVAL_MS);
  interval.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      destroyInterval(interval);
      eventLoopDelay.disable();
    },
  };
}

function nanosecondsToMs(value: number): number | undefined {
  return Number.isFinite(value) ? value / 1_000_000 : undefined;
}

function finiteOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}
