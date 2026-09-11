import assert from "node:assert/strict";
import test from "node:test";
import type { LifecycleWork } from "@nervekit/contracts/runs";
import { LifecycleWorkExecutor } from "../../../src/domains/runs/runtime/lifecycle-work-executor.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const ready: LifecycleWork = {
  id: "work_test",
  deduplicationKey: "run_test:execute",
  conversationId: "conv_test",
  runId: "run_test",
  proposalId: "proposal_test",
  kind: "execute_tool",
  state: "ready",
  inputHash: `sha256:${"a".repeat(64)}`,
  generation: 0,
  attemptCount: 0,
  notBefore: now.toISOString(),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

test("an unclassified tool execution failure becomes outcome_unknown", async () => {
  const settlements: Array<{ state: string; expectedGeneration: number }> = [];
  const executor = new LifecycleWorkExecutor({
    bootId: "boot_test",
    now: () => now,
    store: {
      claimLifecycleWork: async () => ({
        ...ready,
        state: "leased",
        generation: 1,
        attemptCount: 1,
        leaseOwner: "boot_test",
        leaseDeadline: "2026-01-01T00:00:30.000Z",
      }),
      renewLifecycleWork: async () => undefined,
      settleLifecycleWork: async (input) => {
        settlements.push({
          state: input.state,
          expectedGeneration: input.expectedGeneration,
        });
        return { ...ready, state: input.state };
      },
    },
  });

  await executor.execute(ready, async () => {
    throw new Error("connection closed after dispatch");
  });
  assert.deepEqual(settlements, [
    { state: "outcome_unknown", expectedGeneration: 1 },
  ]);
});

test("a stale fenced settlement is reported as lost ownership", async () => {
  let leaseLosses = 0;
  const executor = new LifecycleWorkExecutor({
    bootId: "boot_test",
    now: () => now,
    onLeaseLost: () => {
      leaseLosses += 1;
    },
    store: {
      claimLifecycleWork: async () => ({
        ...ready,
        state: "leased",
        generation: 1,
        attemptCount: 1,
        leaseOwner: "boot_test",
        leaseDeadline: "2026-01-01T00:00:30.000Z",
      }),
      renewLifecycleWork: async () => undefined,
      settleLifecycleWork: async () => undefined,
    },
  });

  await executor.execute(ready, async () => ({ state: "succeeded" }));
  assert.equal(leaseLosses, 1);
});
