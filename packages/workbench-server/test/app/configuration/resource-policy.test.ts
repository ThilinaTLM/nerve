import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendResourcePolicy } from "../../../src/infrastructure/configuration/resource-policy.js";

const GIB = 1024 ** 3;

describe("automatic resource policy", () => {
  it("matches the observed development machine profile", () => {
    const policy = recommendResourcePolicy({
      logicalCpuCount: 20,
      effectiveCpuCount: 4,
      totalMemoryBytes: 38.8 * GIB,
    });
    assert.deepEqual(policy.limits, {
      maxConcurrentModelRuns: 10,
      maxParallelToolsPerRun: 3,
      maxActiveProcesses: 16,
      maxActiveExploreAgents: 5,
    });
    assert.equal(policy.controlWorkConcurrency, 4);
  });

  it("reduces model capacity on memory-constrained hosts", () => {
    assert.equal(
      recommendResourcePolicy({
        logicalCpuCount: 4,
        effectiveCpuCount: 4,
        totalMemoryBytes: 6 * GIB,
      }).limits.maxConcurrentModelRuns,
      4,
    );
    assert.equal(
      recommendResourcePolicy({
        logicalCpuCount: 8,
        effectiveCpuCount: 8,
        totalMemoryBytes: 10 * GIB,
      }).limits.maxConcurrentModelRuns,
      6,
    );
  });

  it("bounds high-capacity hosts and normalizes invalid counts", () => {
    const policy = recommendResourcePolicy({
      logicalCpuCount: 0,
      effectiveCpuCount: 128,
      totalMemoryBytes: 512 * GIB,
    });
    assert.equal(policy.detected.logicalCpuCount, 1);
    assert.equal(policy.limits.maxParallelToolsPerRun, 4);
    assert.equal(policy.limits.maxActiveProcesses, 64);
    assert.equal(policy.limits.maxActiveExploreAgents, 5);
    assert.equal(policy.controlWorkConcurrency, 8);
  });
});
