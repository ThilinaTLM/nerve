import assert from "node:assert/strict";
import test from "node:test";
import type { LifecycleWork } from "@nervekit/contracts/runs";
import { LifecycleWorkDispatcher } from "../../../src/domains/runs/runtime/lifecycle-work-dispatcher.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const ready: LifecycleWork = {
  id: "work_test",
  deduplicationKey: "run_test:continue",
  conversationId: "conv_test",
  runId: "run_test",
  kind: "continue_model",
  state: "ready",
  inputHash: `sha256:${"a".repeat(64)}`,
  generation: 0,
  attemptCount: 0,
  notBefore: now.toISOString(),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

test("wake claims and settles work without a polling delay", async () => {
  const calls: string[] = [];
  let listed = false;
  const dispatcher = new LifecycleWorkDispatcher({
    bootId: "boot_test",
    now: () => now,
    store: {
      listDueLifecycleWork: async () => {
        if (listed) return [];
        listed = true;
        calls.push("list");
        return [ready];
      },
      claimLifecycleWork: async (input) => {
        calls.push("claim");
        return {
          ...ready,
          state: "leased",
          generation: 1,
          attemptCount: 1,
          leaseOwner: input.leaseOwner,
          leaseDeadline: input.leaseDeadline,
        };
      },
      renewLifecycleWork: async () => ready,
      settleLifecycleWork: async () => {
        calls.push("settle");
        return { ...ready, state: "succeeded" };
      },
    },
    handlers: {
      continue_model: async () => {
        calls.push("execute");
        return { state: "succeeded" };
      },
    },
  });

  await dispatcher.wake();
  assert.deepEqual(calls, ["list", "claim", "execute", "settle"]);
});

test("coalesced wakes cannot claim the same work twice", async () => {
  let claims = 0;
  let listed = false;
  const dispatcher = new LifecycleWorkDispatcher({
    bootId: "boot_test",
    now: () => now,
    store: {
      listDueLifecycleWork: async () => {
        if (listed) return [];
        listed = true;
        return [ready];
      },
      claimLifecycleWork: async () => {
        claims += 1;
        return {
          ...ready,
          state: "leased",
          generation: 1,
          attemptCount: 1,
          leaseOwner: "boot_test",
          leaseDeadline: now.toISOString(),
        };
      },
      renewLifecycleWork: async () => ready,
      settleLifecycleWork: async () => ({ ...ready, state: "succeeded" }),
    },
    handlers: { continue_model: async () => ({ state: "succeeded" }) },
  });

  await Promise.all([dispatcher.wake(), dispatcher.wake(), dispatcher.wake()]);
  assert.equal(claims, 1);
});
