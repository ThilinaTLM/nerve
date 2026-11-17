export interface NativeSandboxOptions {
  name: string;
  code: string;
  preludes: Array<{ name: string; source: string }>;
  memoryBytes: number;
  timeoutMs: number;
  maxHostCalls: number;
  uncountedHostMethods?: string[];
  maxOutputBytes: number;
}

export interface NativeSandboxHostCall {
  id: number;
  method: string;
  args: string;
}

export interface NativeSandboxOutcome {
  status: "completed" | "failed" | "timed_out" | "cancelled" | "memory_limit";
  error?: string | null;
  output: string;
  outputTruncated: boolean;
  hostCalls: number;
  durationMs: number;
  memoryUsedBytes: number;
}

export interface NativeSandboxScript {
  reply(id: number, ok: boolean, value: string): boolean;
  cancel(): void;
}

export interface NativeSandboxRuntimeOptions {
  preludes: Array<{ name: string; source: string }>;
  memoryBytes: number;
  timeMsPerInvocation: number;
  hostCallsPerInvocation: number;
  uncountedHostMethods?: string[];
  outputBytes: number;
  stackBytes: number;
}

/** Tagged event from a persistent runtime; unused fields are absent. */
export interface NativeSandboxRuntimeEvent {
  kind: "ready" | "host_call" | "settled" | "closed";
  invocation?: number | null;
  /** host_call: id to reply to. */
  id?: number | null;
  method?: string | null;
  /** host_call: JSON arguments. */
  args?: string | null;
  /** settled: "completed" | "failed" | "timed_out" | "cancelled" | "memory_limit" | "disposed". */
  status?: string | null;
  /** settled: result JSON or error message; ready/closed: failure reason, if any. */
  value?: string | null;
}

export interface NativeSandboxRuntime {
  invoke(invocation: number, fn: string, args: string): boolean;
  reply(id: number, ok: boolean, value: string): boolean;
  cancel(invocation?: number | null): void;
  dispose(): void;
}

/** Optional: addons built before the sandbox domain lack this member. */
export interface NativeSandboxBinding {
  startSandboxScript?(
    options: NativeSandboxOptions,
    hostCall: (error: Error | null, call: NativeSandboxHostCall) => void,
    exit: (error: Error | null, outcome: NativeSandboxOutcome) => void,
  ): NativeSandboxScript;
  openSandboxRuntime?(
    options: NativeSandboxRuntimeOptions,
    events: (error: Error | null, event: NativeSandboxRuntimeEvent) => void,
  ): NativeSandboxRuntime;
}
