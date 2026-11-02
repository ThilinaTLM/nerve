import type { Readable } from "node:stream";

export type NativeContainment = "job-object" | "process-group";
export type TerminationMethod =
  | "job-object"
  | "process-group"
  | "process-tree"
  | "direct-child"
  | "none";

export interface TcpListenerProcess {
  protocol: "tcp" | "tcp6";
  address: string;
  port: number;
  pid: number;
  processGroupId?: number;
  identity: string;
  processName?: string;
}

export interface ManagedTarget {
  pid: number;
  processGroupId?: number;
  containment: NativeContainment;
  identity: string;
}

export type InspectionResult =
  | { evidence: "alive_verified"; detail?: string }
  | { evidence: "exited_verified"; detail?: string }
  | { evidence: "identity_mismatch"; detail?: string }
  | { evidence: "unknown"; detail: string };

export interface TerminationResult {
  attempted: boolean;
  terminated: boolean;
  method: TerminationMethod;
  error?: string;
}

export type ManagedProcessExitReason =
  | "exited"
  | "signal"
  | "timeout"
  | "memory_limit"
  | "cpu_limit"
  | "process_limit"
  | "output_limit"
  | "daemon_shutdown"
  | "internal";

export interface ManagedProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason?: ManagedProcessExitReason;
  /** Set on `closed` when output was detached while descendants still held the pipes. */
  outputDetached?: boolean;
}

export interface ManagedProcessOutputStats {
  stdoutObservedBytes: number;
  stderrObservedBytes: number;
  stdoutDeliveredBytes: number;
  stderrDeliveredBytes: number;
  stdoutOmittedBytes: number;
  stderrOmittedBytes: number;
  totalObservedBytes: number;
  totalDeliveredBytes: number;
  totalOmittedBytes: number;
}

export interface ManagedProcessEnforcement {
  resource: string;
  status: "enforced" | "fallback" | "unsupported";
  method: string;
  detail?: string;
}

export interface ManagedProcessOutputPolicy {
  queueBytes?: number;
  batchBytes?: number;
  totalBytes?: number;
  overflow?: "truncate" | "terminate";
}

export interface ManagedProcessResourcePolicy {
  enforcement?: "required" | "best-effort";
  memoryBytes?: number;
  maxCpuCores?: number;
  maxProcesses?: number;
  wallTimeMs?: number;
  output?: ManagedProcessOutputPolicy;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly target: ManagedTarget;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly enforcement: readonly ManagedProcessEnforcement[];
  readonly exited: Promise<ManagedProcessExit>;
  readonly closed: Promise<ManagedProcessExit>;
  readonly outputStats: Promise<ManagedProcessOutputStats>;
  terminate(signal?: NodeJS.Signals): Promise<TerminationResult>;
}

export interface ManagedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  policy?: ManagedProcessResourcePolicy;
  /**
   * Settle `closed` shortly after the root exits even if descendants still hold
   * the output pipes. Later output is drained and discarded; containment is kept.
   */
  detachOutputAfterExit?: boolean;
}

export interface ManagedProcessRuntimeOptions {
  maxActiveProcesses: number;
}
