import type {
  LogReadOptions,
  ManagedContainerCreateSpec,
  ManagedContainerRef,
  ManagedContainerStatus,
  RemoveOptions,
  RuntimeDriverCapabilities,
  SandboxManagerBackendOption,
  StopOptions,
} from "@nervekit/contracts";

export type LogChunk = {
  stream: "stdout" | "stderr";
  chunk: string;
  ts?: string;
};

export interface ContainerRuntimeDriver {
  readonly kind: string;
  capabilities():
    | Promise<RuntimeDriverCapabilities>
    | RuntimeDriverCapabilities;
  create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef>;
  start(ref: ManagedContainerRef): Promise<void>;
  inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus>;
  logs(
    ref: ManagedContainerRef,
    options?: LogReadOptions,
  ): AsyncIterable<LogChunk>;
  stop(ref: ManagedContainerRef, options?: StopOptions): Promise<void>;
  kill(ref: ManagedContainerRef, signal?: string): Promise<void>;
  remove(ref: ManagedContainerRef, options?: RemoveOptions): Promise<void>;
  listManaged?(): Promise<ManagedContainerRef[]>;
  backendOptions?(): Promise<SandboxManagerBackendOption[]>;
}

export function unavailableRuntimeCapabilities(
  kind: string,
  limitation = `${kind} driver scaffold is not connected to a runtime`,
): RuntimeDriverCapabilities {
  return {
    kind,
    available: false,
    supportsReadOnlyRootFilesystem: false,
    supportsNoNewPrivileges: false,
    supportsPidsLimit: false,
    supportsCpuLimit: false,
    supportsMemoryLimit: false,
    supportsTmpfs: false,
    supportsLogs: false,
    limitations: [limitation],
  };
}
