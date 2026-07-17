import type {
  DaemonChildHandle,
  DaemonConnectionPorts,
} from "../../src/daemon/ports.ts";
import type {
  ChildExit,
  DaemonPaths,
  HealthyDaemon,
} from "../../src/daemon/types.ts";

interface PendingDelay {
  at: number;
  resolve: () => void;
}

interface FakeInterval {
  ms: number;
  next: number;
  callback: () => void;
  cancelled: boolean;
}

/** Deterministic virtual-time scheduler. No real timers or delays. */
export class FakeScheduler {
  time = 0;
  private readonly delays: PendingDelay[] = [];
  private readonly intervals: FakeInterval[] = [];

  now(): number {
    return this.time;
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.delays.push({ at: this.time + ms, resolve });
    });
  }

  every(ms: number, callback: () => void): () => void {
    const interval: FakeInterval = {
      ms,
      next: this.time + ms,
      callback,
      cancelled: false,
    };
    this.intervals.push(interval);
    return () => {
      interval.cancelled = true;
    };
  }

  get activeIntervals(): number {
    return this.intervals.filter((interval) => !interval.cancelled).length;
  }

  /** Advances virtual time, firing due delays/intervals in timestamp order. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      await drainMicrotasks();
      const dueDelay = this.delays
        .filter((delay) => delay.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      const dueInterval = this.intervals
        .filter((interval) => !interval.cancelled && interval.next <= target)
        .sort((a, b) => a.next - b.next)[0];
      const delayAt = dueDelay?.at ?? Number.POSITIVE_INFINITY;
      const intervalAt = dueInterval?.next ?? Number.POSITIVE_INFINITY;
      if (
        delayAt === Number.POSITIVE_INFINITY &&
        intervalAt === Number.POSITIVE_INFINITY
      ) {
        break;
      }
      if (delayAt <= intervalAt && dueDelay) {
        this.time = Math.max(this.time, dueDelay.at);
        this.delays.splice(this.delays.indexOf(dueDelay), 1);
        dueDelay.resolve();
      } else if (dueInterval) {
        this.time = Math.max(this.time, dueInterval.next);
        dueInterval.next += dueInterval.ms;
        dueInterval.callback();
      }
    }
    this.time = target;
    await drainMicrotasks();
  }
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

export class FakeChild {
  readonly kills: string[] = [];
  exited = false;
  /** When true (default), SIGTERM makes the child exit on the next tick. */
  exitOnSigterm = true;

  constructor(
    readonly pid: number,
    private readonly callbacks: {
      onOutput: (stream: "stdout" | "stderr", chunk: unknown) => void;
      onError: (error: Error) => void;
      onExit: (exit: ChildExit) => void;
    },
  ) {}

  handle(): DaemonChildHandle {
    return {
      pid: this.pid,
      kill: (signal) => {
        this.kills.push(signal);
        if (this.exited) return true;
        if (
          signal === "SIGKILL" ||
          (signal === "SIGTERM" && this.exitOnSigterm)
        ) {
          queueMicrotask(() => this.exit(null, signal));
        }
        return true;
      },
    };
  }

  emitOutput(stream: "stdout" | "stderr", chunk: string): void {
    this.callbacks.onOutput(stream, chunk);
  }

  emitError(error: Error): void {
    this.callbacks.onError(error);
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.callbacks.onExit({ code, signal });
  }
}

export interface RecordedCrashReport {
  home: string;
  kind: string;
  message: string;
  pid?: number;
  exitCode?: number | null;
  signal?: string | null;
  uptimeMs?: number;
  outputTail?: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

export function healthyDaemon(
  overrides: Partial<HealthyDaemon["daemon"]> = {},
): HealthyDaemon {
  return {
    daemon: {
      daemonId: "daemon_test",
      pid: 4242,
      host: "127.0.0.1",
      port: 3747,
      url: "http://127.0.0.1:3747",
      startedAt: "2026-07-17T00:00:00.000Z",
      dataDir: "/home/test/.nerve",
      version: "0.8.0",
      ...overrides,
    } as HealthyDaemon["daemon"],
    url: "http://127.0.0.1:3747",
    token: "tok_local",
  };
}

export interface FakeDaemonWorld {
  ports: DaemonConnectionPorts;
  scheduler: FakeScheduler;
  children: FakeChild[];
  launches: Array<{ serverMain: string; env: NodeJS.ProcessEnv; at: number }>;
  crashReports: RecordedCrashReport[];
  logs: Array<{ level: string; message: string }>;
  healthResults: { value: boolean };
  healthChecks: Array<{ url: string; token: string }>;
  discoveryResults: Array<HealthyDaemon | undefined>;
  discoveryCalls: DaemonPaths[];
  parentExitHooks: Array<() => void>;
}

export function fakeDaemonWorld(
  overrides: Partial<{
    env: NodeJS.ProcessEnv;
    serverMainExists: boolean;
    /** Discovery results consumed in order; the last value repeats. */
    discovery: Array<HealthyDaemon | undefined>;
  }> = {},
): FakeDaemonWorld {
  const scheduler = new FakeScheduler();
  const children: FakeChild[] = [];
  const launches: Array<{
    serverMain: string;
    env: NodeJS.ProcessEnv;
    at: number;
  }> = [];
  const crashReports: RecordedCrashReport[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  const healthResults = { value: true };
  const healthChecks: Array<{ url: string; token: string }> = [];
  const discoveryResults = overrides.discovery ?? [healthyDaemon()];
  const discoveryCalls: DaemonPaths[] = [];
  const parentExitHooks: Array<() => void> = [];

  const ports: DaemonConnectionPorts = {
    env: overrides.env ?? {},
    health: {
      isHealthy: async (url, token) => {
        healthChecks.push({ url, token });
        return healthResults.value;
      },
    },
    discovery: {
      findHealthyDaemon: async (paths) => {
        discoveryCalls.push(paths);
        const result =
          discoveryResults.length > 1
            ? discoveryResults.shift()
            : discoveryResults[0];
        return result;
      },
    },
    launcher: {
      launch: (input) => {
        launches.push({
          serverMain: input.serverMain,
          env: input.env,
          at: scheduler.now(),
        });
        const child = new FakeChild(100 + children.length, input);
        children.push(child);
        return child.handle();
      },
    },
    scheduler,
    parentExit: {
      onParentExit: (hook) => {
        parentExitHooks.push(hook);
        return () => {
          const index = parentExitHooks.indexOf(hook);
          if (index !== -1) parentExitHooks.splice(index, 1);
        };
      },
    },
    crashReporter: {
      write: (home, report) => {
        crashReports.push({ home, ...report });
        return `/crash/${crashReports.length}.json`;
      },
    },
    logger: {
      log: (level, message) => {
        logs.push({ level, message });
      },
    },
    networkInterfaces: () => ({
      eth0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
    }),
    resolveServerMain: () => "/opt/nerve/server/main.js",
    fileExists: async () => overrides.serverMainExists ?? true,
  };

  return {
    ports,
    scheduler,
    children,
    launches,
    crashReports,
    logs,
    healthResults,
    healthChecks,
    discoveryResults,
    discoveryCalls,
    parentExitHooks,
  };
}
