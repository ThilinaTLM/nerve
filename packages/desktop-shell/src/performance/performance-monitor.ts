import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const SAMPLE_INTERVAL_MS = 10_000;

type ElectronProcessMetric = {
  pid: number;
  type: string;
  cpu?: {
    percentCPUUsage?: number;
    idleWakeupsPerSecond?: number;
  };
  memory?: {
    workingSetSize?: number;
    peakWorkingSetSize?: number;
    privateBytes?: number;
    sharedBytes?: number;
  };
};

type IntervalHandle = ReturnType<typeof setInterval>;

type DesktopPerformanceMonitorOptions = {
  enabled: boolean;
  dataDir: string;
  sessionId?: string;
  pid?: number;
  getMetrics: () => ElectronProcessMetric[];
  getWindowState: () => { visible: boolean; minimized: boolean } | undefined;
  append?: (path: string, line: string) => Promise<void>;
  now?: () => Date;
  setInterval?: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  warn?: (error: unknown) => void;
};

export type DesktopPerformanceMonitor = { stop: () => void };

async function appendJsonLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, "utf8");
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function performanceLogFilename(
  sessionId: string | undefined,
  source: "desktop",
  now: Date,
  pid: number,
): string {
  const safeSessionId = SAFE_SESSION_ID.test(sessionId ?? "")
    ? sessionId
    : `${now.toISOString().replace(/[-:.]/g, "")}-${source}-${Math.max(0, Math.trunc(pid))}`;
  return `performance-${safeSessionId}.jsonl`;
}

function kilobytesToBytes(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 1024;
}

export function installDesktopPerformanceMonitor(
  options: DesktopPerformanceMonitorOptions,
): DesktopPerformanceMonitor {
  if (!options.enabled) return { stop: () => undefined };

  const append = options.append ?? appendJsonLine;
  const now = options.now ?? (() => new Date());
  const createInterval = options.setInterval ?? setInterval;
  const destroyInterval = options.clearInterval ?? clearInterval;
  const path = join(
    options.dataDir,
    "logs",
    performanceLogFilename(
      options.sessionId,
      "desktop",
      now(),
      options.pid ?? process.pid,
    ),
  );
  let stopped = false;
  let writing = false;
  let warned = false;

  const sample = () => {
    if (stopped || writing) return;
    writing = true;
    const record = {
      type: "nerve.performance",
      source: "desktop",
      ts: now().toISOString(),
      window: options.getWindowState(),
      processes: options.getMetrics().map((metric) => ({
        pid: metric.pid,
        role: metric.type,
        cpuPercent: metric.cpu?.percentCPUUsage,
        idleWakeupsPerSecond: metric.cpu?.idleWakeupsPerSecond,
        rssBytes: kilobytesToBytes(metric.memory?.workingSetSize),
        peakRssBytes: kilobytesToBytes(metric.memory?.peakWorkingSetSize),
        privateBytes: kilobytesToBytes(metric.memory?.privateBytes),
        sharedBytes: kilobytesToBytes(metric.memory?.sharedBytes),
      })),
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
