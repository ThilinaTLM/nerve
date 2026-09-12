import { availableParallelism, cpus, totalmem } from "node:os";
import type {
  DetectedResourceCapacity,
  ResourceLimits,
} from "@nervekit/contracts/settings";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export interface HostResourceFacts {
  logicalCpuCount: number;
  effectiveCpuCount: number;
  totalMemoryBytes: number;
}

export interface RecommendedResourcePolicy {
  detected: DetectedResourceCapacity;
  limits: ResourceLimits;
  controlWorkConcurrency: number;
}

export function detectHostResourceFacts(): HostResourceFacts {
  return {
    logicalCpuCount: Math.max(1, cpus().length),
    effectiveCpuCount: Math.max(1, availableParallelism()),
    totalMemoryBytes: Math.max(GIB, totalmem()),
  };
}

export function recommendResourcePolicy(
  facts: HostResourceFacts,
): RecommendedResourcePolicy {
  const logicalCpuCount = positiveInteger(facts.logicalCpuCount);
  const effectiveCpuCount = positiveInteger(facts.effectiveCpuCount);
  const totalMemoryBytes = Math.max(GIB, facts.totalMemoryBytes);
  const totalMemoryGiB = totalMemoryBytes / GIB;
  const modelRuns = totalMemoryGiB < 8 ? 4 : totalMemoryGiB < 12 ? 6 : 10;
  const usableMemoryGiB = Math.max(
    2,
    totalMemoryGiB - Math.max(4, totalMemoryGiB * 0.25),
  );

  return {
    detected: {
      logicalCpuCount,
      effectiveCpuCount,
      totalMemoryMb: Math.max(1, Math.floor(totalMemoryBytes / MIB)),
    },
    limits: {
      maxConcurrentModelRuns: modelRuns,
      maxParallelToolsPerRun: clamp(
        1 + Math.floor(Math.sqrt(effectiveCpuCount)),
        2,
        4,
      ),
      maxActiveProcesses: clamp(
        Math.min(effectiveCpuCount * 4, Math.floor(usableMemoryGiB * 2)),
        8,
        64,
      ),
      maxActiveExploreAgents: clamp(Math.floor(modelRuns / 2), 2, 8),
    },
    controlWorkConcurrency: clamp(effectiveCpuCount, 2, 8),
  };
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.floor(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
