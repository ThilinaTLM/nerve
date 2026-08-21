import type { ManagedProcessResourcePolicy } from "@nervekit/native";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const NATIVE_WALL_TIME_GUARD_MS = 3_000;

function guardedWallTime(timeoutMs: number | undefined): number | undefined {
  return timeoutMs === undefined
    ? undefined
    : timeoutMs + NATIVE_WALL_TIME_GUARD_MS;
}

const output = (
  totalBytes: number,
): NonNullable<ManagedProcessResourcePolicy["output"]> => ({
  queueBytes: MIB,
  batchBytes: 256 * 1024,
  totalBytes,
  overflow: "terminate",
});

export function bashProcessPolicy(
  timeoutMs?: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 4 * GIB,
    maxCpuCores: 4,
    maxProcesses: 128,
    wallTimeMs: guardedWallTime(timeoutMs),
    output: output(256 * MIB),
  };
}

export function pythonProcessPolicy(
  timeoutMs: number,
): ManagedProcessResourcePolicy {
  return {
    enforcement: "best-effort",
    memoryBytes: 2 * GIB,
    maxCpuCores: 2,
    maxProcesses: 64,
    wallTimeMs: guardedWallTime(timeoutMs),
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
