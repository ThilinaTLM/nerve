import type { PairingCode, PairingPurpose } from "@nervekit/contracts/access";
import type { DaemonCrashReportKind } from "@nervekit/contracts/logs";
import type { ServerLifecycleState } from "@nervekit/contracts/status";
import type { ChildExit, DaemonPaths, HealthyDaemon } from "./contracts.js";
import type { NetworkInterfacesSnapshot } from "./urls.js";

/**
 * Narrow runtime seams for the daemon connection service and supervisor. The
 * platform-neutral state machine receives these ports and never touches
 * Electron, `spawn`, the filesystem, global timers, or crash files directly.
 */

export type DaemonHealthOutcome =
  | "ok"
  | "timeout"
  | "http_error"
  | "network_error";

export interface DaemonHealthCheckResult {
  healthy: boolean;
  outcome: DaemonHealthOutcome;
  durationMs: number;
  status?: number;
  error?: string;
  /** Server lifecycle from a healthy response body, when it could be parsed. */
  lifecycle?: ServerLifecycleState;
  /** Replacement device credential from the `x-nerve-credential` header. */
  rotatedCredential?: string;
}

export interface DaemonHealthPort {
  check(url: string, token: string): Promise<DaemonHealthCheckResult>;
}

export interface DaemonDiscoveryPort {
  /** Reads daemon/token files under `paths` and health-checks the daemon. */
  findHealthyDaemon(paths: DaemonPaths): Promise<HealthyDaemon | undefined>;
  /** Re-reads `secrets/daemon-token` (it changes on local token rotation). */
  readLocalToken(paths: DaemonPaths): Promise<string>;
}

/** Failed `/api/access/*` call; `code` is the access error code when present. */
export class DaemonAccessError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "DaemonAccessError";
  }
}

export interface DaemonAccessPort {
  /** Mints a pairing code; `bearer` must be an authenticated principal. */
  createPairingCode(
    url: string,
    bearer: string,
    purpose: PairingPurpose,
  ): Promise<PairingCode>;
  /** Redeems a code for a bearer device credential (`nd_<id>.<secret>`). */
  redeemPairingCode(
    url: string,
    input: { code: string; deviceName: string },
  ): Promise<string>;
}

/** Device credentials for remote daemons, kept per origin (OS-encrypted). */
export interface RemoteCredentialStorePort {
  load(origin: string): Promise<string | undefined>;
  save(origin: string, credential: string): Promise<void>;
  forget(origin: string): Promise<void>;
}

export interface DaemonDiagnosticCaptureResult {
  outcome: "captured" | "timed_out" | "unsupported" | "request_failed";
  elapsedMs: number;
  path?: string;
  error?: string;
}

export interface DaemonChildHandle {
  readonly pid?: number;
  kill(signal: "SIGTERM" | "SIGKILL"): boolean;
  requestDiagnosticReport(
    dataDir: string,
  ): Promise<DaemonDiagnosticCaptureResult>;
}

export interface DaemonChildLauncherPort {
  launch(input: {
    serverMain: string;
    args?: string[];
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
  access: DaemonAccessPort;
  credentials: RemoteCredentialStorePort;
  networkInterfaces(): NetworkInterfacesSnapshot;
}

export interface DaemonConnectionPorts extends DaemonRuntimePorts {
  /** Version of the workbench server bundled with this desktop build. */
  readonly bundledDaemonVersion: string;
  /** Name this desktop registers under when it pairs with a remote daemon. */
  deviceName: string;
  /** Resolves the workbench-server main entry path. */
  resolveServerMain(): string;
  fileExists(path: string): Promise<boolean>;
  env: NodeJS.ProcessEnv;
}
