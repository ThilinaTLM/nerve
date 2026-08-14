import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

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

export type DaemonPerformanceCounts = Record<string, number>;

type DaemonPerformanceMonitorOptions = {
  enabled: boolean;
  dataDir: string;
  getCounts: () => DaemonPerformanceCounts;
  cpuUsage?: () => CpuUsage;
  memoryUsage?: () => MemoryUsage;
  uptime?: () => number;
  activeHandles?: () => number;
  activeRequests?: () => number;
  now?: () => Date;
  monotonicNowMs?: () => number;
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
  const append = options.append ?? appendJsonLine;
  const createInterval = options.setInterval ?? setInterval;
  const destroyInterval = options.clearInterval ?? clearInterval;
  const path = join(options.dataDir, "logs", "performance.jsonl");
  let previousCpu = cpuUsage();
  let previousAtMs = monotonicNowMs();
  let stopped = false;
  let writing = false;
  let warned = false;

  const sample = () => {
    if (stopped || writing) return;
    const currentCpu = cpuUsage();
    const currentAtMs = monotonicNowMs();
    const elapsedMicros = Math.max(0, currentAtMs - previousAtMs) * 1000;
    const consumedMicros =
      currentCpu.user +
      currentCpu.system -
      previousCpu.user -
      previousCpu.system;
    previousCpu = currentCpu;
    previousAtMs = currentAtMs;
    const memory = memoryUsage();
    writing = true;
    const record = {
      type: "nerve.performance",
      source: "daemon",
      ts: now().toISOString(),
      pid: process.pid,
      uptimeMs: Math.round(uptime() * 1000),
      cpuPercent:
        elapsedMicros > 0
          ? Math.max(0, (consumedMicros / elapsedMicros) * 100)
          : undefined,
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      activeHandles: activeHandles(),
      activeRequests: activeRequests(),
      counts: options.getCounts(),
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
    },
  };
}
