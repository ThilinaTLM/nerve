import type { ManagedProcessResourcePolicy } from "@nervekit/native";

const MIB = 1024 * 1024;

export function harnessProcessPolicy(
  wallTimeMs?: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 2 * 1024 * MIB,
    maxCpuCores: 2,
    maxProcesses: 64,
    wallTimeMs,
    output: {
      queueBytes: MIB,
      batchBytes: 256 * 1024,
      totalBytes: 64 * MIB,
      overflow: "terminate",
    },
  };
}
