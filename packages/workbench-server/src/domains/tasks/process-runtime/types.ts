import type { ChildProcess } from "node:child_process";
import type { TaskListeningPort, TaskRuntime } from "@nervekit/contracts";

export type RuntimeInspection =
  | { evidence: "alive_verified"; runtime: TaskRuntime }
  | { evidence: "exited_verified" }
  | { evidence: "identity_mismatch"; detail: string }
  | { evidence: "unknown"; detail: string };

export interface SpawnProcessOptions {
  cwd: string;
  env?: Record<string, string>;
  shellPath?: string;
}

export type ProcessLifecycleResult =
  | {
      kind: "closed";
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }
  | { kind: "error"; error: Error };

export interface SpawnedProcess {
  child: ChildProcess;
  runtime: Promise<TaskRuntime>;
  exited: Promise<ProcessLifecycleResult>;
  closed: Promise<ProcessLifecycleResult>;
}

export interface TerminationResult {
  attempted: boolean;
  method: "process-group" | "direct-child" | "taskkill" | "none";
  error?: string;
}

export interface ProcessRuntimeDriver {
  spawn(command: string, options: SpawnProcessOptions): SpawnedProcess;
  inspect(runtime: TaskRuntime): Promise<RuntimeInspection>;
  terminate(
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminationResult>;
  terminateChild(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminationResult>;
  listeningPorts(runtime: TaskRuntime): Promise<TaskListeningPort[]>;
}
