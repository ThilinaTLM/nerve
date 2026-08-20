import type { ManagedProcessResourcePolicy } from "@nervekit/native";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const output = (
  totalBytes: number,
): NonNullable<ManagedProcessResourcePolicy["output"]> => ({
  queueBytes: MIB,
  batchBytes: 256 * 1024,
  totalBytes,
  overflow: "terminate",
});

export function bashProcessPolicy(
  wallTimeMs?: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 4 * GIB,
    maxCpuCores: 4,
    maxProcesses: 128,
    wallTimeMs,
    output: output(256 * MIB),
  };
}

export function pythonProcessPolicy(
  wallTimeMs: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 2 * GIB,
    maxCpuCores: 2,
    maxProcesses: 64,
    wallTimeMs,
    output: output(128 * MIB),
  };
}

export const searchProcessPolicy: ManagedProcessResourcePolicy = {
  enforcement: "best-effort",
  memoryBytes: GIB,
  maxCpuCores: 2,
  maxProcesses: 32,
  wallTimeMs: 30_000,
  output: output(64 * MIB),
};

export const gitProcessPolicy: ManagedProcessResourcePolicy = {
  enforcement: "best-effort",
  memoryBytes: GIB,
  maxCpuCores: 2,
  maxProcesses: 32,
  wallTimeMs: 20_000,
  output: output(32 * MIB),
};
