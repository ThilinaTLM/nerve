import type { ManagedProcessResourcePolicy } from "@nervekit/native";

export function taskProcessPolicy(
  wallTimeMs?: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 4 * 1024 * 1024 * 1024,
    maxCpuCores: 4,
    maxProcesses: 256,
    wallTimeMs,
    output: {
      queueBytes: 4 * 1024 * 1024,
      batchBytes: 256 * 1024,
    },
  };
}
