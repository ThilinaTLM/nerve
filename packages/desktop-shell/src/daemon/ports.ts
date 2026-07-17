import type { DaemonCrashReportKind } from "@nervekit/contracts";
import type { ChildExit, DaemonPaths, HealthyDaemon } from "./types.js";
import type { NetworkInterfacesSnapshot } from "./urls.js";

/**
 * Narrow runtime seams for the daemon connection service and supervisor. The
 * platform-neutral state machine receives these ports and never touches
 * Electron, `spawn`, the filesystem, global timers, or crash files directly.
 */

export interface DaemonHealthPort {
  isHealthy(url: string, token: string): Promise<boolean>;
}

export interface DaemonDiscoveryPort {
  /** Reads daemon/token files under `paths` and health-checks the daemon. */
  findHealthyDaemon(paths: DaemonPaths): Promise<HealthyDaemon | undefined>;
}

export interface DaemonChildHandle {
  readonly pid?: number;
  kill(signal: "SIGTERM" | "SIGKILL"): boolean;
}

export interface DaemonChildLauncherPort {
  launch(input: {
    serverMain: string;
    env: NodeJS.ProcessEnv;
    onOutput: (stream: "stdout" | "stderr", chunk: unknown) => void;
    onError: (error: Error) => void;
    onExit: (exit: ChildExit) => void;
  }): DaemonChildHandle;
}

export interface DaemonSchedulerPort {
  now(): number;
  delay(ms: number): Promise<void>;
  /** Starts a repeating timer; returns the cancel function. */
  every(ms: number, callback: () => void): () => void;
}

export interface ParentExitHookPort {
  /** Registers a parent-process exit hook; returns the remove function. */
  onParentExit(hook: () => void): () => void;
}

export interface DaemonCrashReporterPort {
  write(
    home: string,
    report: {
      kind: DaemonCrashReportKind;
      message: string;
      pid?: number;
      exitCode?: number | null;
      signal?: string | null;
      uptimeMs?: number;
      outputTail?: string;
      error?: unknown;
      context?: Record<string, unknown>;
    },
  ): string | undefined;
}

export interface DaemonLoggerPort {
  log(
    level: "info" | "warn" | "error",
    message: string,
    data?: { error?: unknown; context?: Record<string, unknown> },
  ): void;
}

export interface DaemonRuntimePorts {
  health: DaemonHealthPort;
  discovery: DaemonDiscoveryPort;
  launcher: DaemonChildLauncherPort;
  scheduler: DaemonSchedulerPort;
  parentExit: ParentExitHookPort;
  crashReporter: DaemonCrashReporterPort;
  logger: DaemonLoggerPort;
  networkInterfaces(): NetworkInterfacesSnapshot;
}

export interface DaemonConnectionPorts extends DaemonRuntimePorts {
  /** Resolves the workbench-server main entry path. */
  resolveServerMain(): string;
  fileExists(path: string): Promise<boolean>;
  env: NodeJS.ProcessEnv;
}
