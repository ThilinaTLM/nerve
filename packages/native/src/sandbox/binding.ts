export interface NativeSandboxOptions {
  name: string;
  code: string;
  preludes: Array<{ name: string; source: string }>;
  memoryBytes: number;
  timeoutMs: number;
  maxHostCalls: number;
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

/** Optional: addons built before the sandbox domain lack this member. */
export interface NativeSandboxBinding {
  startSandboxScript?(
    options: NativeSandboxOptions,
    hostCall: (error: Error | null, call: NativeSandboxHostCall) => void,
    exit: (error: Error | null, outcome: NativeSandboxOutcome) => void,
  ): NativeSandboxScript;
}
