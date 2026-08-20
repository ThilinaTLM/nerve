import type {
  InspectionResult,
  ManagedProcessEnforcement,
  ManagedProcessOutputStats,
  ManagedProcessResourcePolicy,
  ManagedTarget,
  NativeContainment,
  TerminationResult,
} from "./types.js";

export interface NativeOutputEvent {
  stream: "stdout" | "stderr";
  data: Buffer;
}

export interface NativeOutputDrain {
  events: NativeOutputEvent[];
  hasMore: boolean;
  pipesClosed: boolean;
  stats: ManagedProcessOutputStats;
}

export interface NativeProcessHandle {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly processGroupId?: number;
  readonly target: ManagedTarget;
  readonly batchBytes: number;
  readonly enforcement: ManagedProcessEnforcement[];
  drainOutput(maximumBytes?: number): NativeOutputDrain;
  terminate(signal?: string): TerminationResult;
}

export interface ProcessNativeBinding {
  inspectManagedTarget(target: ManagedTarget): InspectionResult;
  terminateManagedTarget(
    target: ManagedTarget,
    signal?: string,
  ): TerminationResult;
  configureManagedProcessRuntime(options: { maxActiveProcesses: number }): void;
  spawnManagedProcess(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      policy?: ManagedProcessResourcePolicy;
    },
    outputReady: (error: Error | null) => void,
    exit: (error: Error | null, result: [number, string, string]) => void,
  ): NativeProcessHandle;
}
