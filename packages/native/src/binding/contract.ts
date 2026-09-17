import type {
  NativeGitAncestryResult,
  NativeGitDocumentSource,
  NativeGitFileDiffResult,
  NativeGitRepositoryInfoResult,
  NativeGitRevisionResult,
  NativeGitSnapshotOptions,
  NativeGitSnapshotResult,
} from "../git/contracts.js";
import type {
  ChangeMonitorOptions,
  ChangeNotice,
  DirectoryMonitorScope,
  GitMonitorScope,
  MonitorDiagnostics,
  MonitorScopeState,
} from "../monitor/contracts.js";
import type {
  InspectionResult,
  ManagedProcessEnforcement,
  ManagedProcessOutputStats,
  ManagedProcessResourcePolicy,
  ManagedTarget,
  NativeContainment,
  TerminationResult,
  TcpListenerProcess,
} from "../process/contracts.js";

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

export interface NativeChangeMonitorHandle {
  syncDirectories(scope: DirectoryMonitorScope): Promise<MonitorScopeState>;
  syncGit(scope: GitMonitorScope): Promise<MonitorScopeState>;
  requestRefresh(scopeId: string): Promise<number>;
  remove(scopeId: string): Promise<void>;
  diagnostics(): MonitorDiagnostics;
  close(): Promise<void>;
}

export interface NativeBinding {
  runtimeCapabilities(): { platform: string; capabilities: string[] };
  initializeManagedProcessHost(options: {
    delegatedScope?: boolean;
    allowUncontained?: boolean;
  }): {
    backend: "cgroup_v2" | "windows_job" | "process_group";
    hardLimitsAvailable: boolean;
    enforcement: "required" | "best_effort";
    detail?: string;
  };
  readGitRepositoryInfo(path: string): Promise<NativeGitRepositoryInfoResult>;
  readGitSnapshot(
    path: string,
    options?: NativeGitSnapshotOptions,
  ): Promise<NativeGitSnapshotResult>;
  checkGitAncestry(
    path: string,
    ancestor: string,
    descendant: string,
  ): Promise<NativeGitAncestryResult>;
  resolveGitRevision(
    path: string,
    revision: string,
  ): Promise<NativeGitRevisionResult>;
  readGitFileDiff(
    path: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiffResult>;
  validateGitBranchName(name: string): boolean;
  inspectTcpListeners(port?: number): TcpListenerProcess[];
  terminateTcpListener(
    listener: TcpListenerProcess,
    signal?: string,
  ): TerminationResult;
  inspectManagedTarget(target: ManagedTarget): InspectionResult;
  terminateManagedTarget(
    target: ManagedTarget,
    signal?: string,
  ): TerminationResult;
  createChangeMonitor(
    options: ChangeMonitorOptions | undefined,
    notice: (error: Error | null, notice: ChangeNotice) => void,
  ): NativeChangeMonitorHandle;
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
