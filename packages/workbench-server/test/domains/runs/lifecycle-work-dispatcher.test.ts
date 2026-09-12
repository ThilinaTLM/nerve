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

test("start drains recovery work without awaiting its execution", async () => {
  let listed = false;
  let releaseExecution!: () => void;
  const executionBlocked = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  let executionStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    executionStarted = resolve;
  });
  const dispatcher = new LifecycleWorkDispatcher({
    bootId: "boot_test",
    now: () => now,
    store: {
      listDueLifecycleWork: async () => {
        if (listed) return [];
        listed = true;
        return [ready];
      },
      claimLifecycleWork: async (input) => ({
        ...ready,
        state: "leased",
        generation: 1,
        attemptCount: 1,
        leaseOwner: input.leaseOwner,
        leaseDeadline: input.leaseDeadline,
      }),
      renewLifecycleWork: async () => ready,
      settleLifecycleWork: async () => ({ ...ready, state: "succeeded" }),
    },
    handlers: {
      continue_model: async () => {
        executionStarted();
        await executionBlocked;
        return { state: "succeeded" };
      },
    },
  });

  dispatcher.start(60_000);
  await started;
  let settled = false;
  void dispatcher.settled().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  dispatcher.stopPolling();
  releaseExecution();
  await dispatcher.settled();
});

test("a wake refills free slots while an earlier handler is still running", async () => {
  const queued = new Map<string, LifecycleWork>([[ready.id, ready]]);
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const firstStart = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let secondStarted!: () => void;
  const secondStart = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  const second = {
    ...ready,
    id: "work_second",
    runId: "run_second",
    deduplicationKey: "run_second:continue",
  };
  const dispatcher = new LifecycleWorkDispatcher({
    bootId: "boot_test",
    concurrency: 2,
    now: () => now,
    store: {
      listDueLifecycleWork: async () => [...queued.values()],
      claimLifecycleWork: async (input) => {
        const work = queued.get(input.workId);
        if (!work) return undefined;
        queued.delete(input.workId);
        return {
          ...work,
          state: "leased",
          generation: 1,
          attemptCount: 1,
          leaseOwner: input.leaseOwner,
          leaseDeadline: input.leaseDeadline,
        };
      },
      renewLifecycleWork: async () => ready,
      settleLifecycleWork: async () => ({ ...ready, state: "succeeded" }),
    },
    handlers: {
      continue_model: async (work) => {
        if (work.id === ready.id) {
          firstStarted();
          await firstBlocked;
        } else {
          secondStarted();
        }
        return { state: "succeeded" };
      },
    },
  });

  void dispatcher.wake();
  await firstStart;
  queued.set(second.id, second);
  void dispatcher.wake();
  await secondStart;
  releaseFirst();
  await dispatcher.settled();
});

test("model and control work use independent concurrency lanes", async () => {
  const control = {
    ...ready,
    id: "work_control",
    kind: "reconcile_conversation" as const,
    runId: undefined,
    deduplicationKey: "conv_test:reconcile",
  };
  const queued = new Map<string, LifecycleWork>([[ready.id, ready]]);
  let releaseModel!: () => void;
  const modelBlocked = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  let modelStarted!: () => void;
  const modelStart = new Promise<void>((resolve) => {
    modelStarted = resolve;
  });
  let controlStarted!: () => void;
  const controlStart = new Promise<void>((resolve) => {
    controlStarted = resolve;
  });
  const dispatcher = new LifecycleWorkDispatcher({
    bootId: "boot_test",
    concurrencyByLane: { model: 1, control: 1 },
    now: () => now,
    store: {
      listDueLifecycleWork: async () => [...queued.values()],
      claimLifecycleWork: async (input) => {
        const work = queued.get(input.workId);
        if (!work) return undefined;
        queued.delete(input.workId);
        return {
          ...work,
          state: "leased",
          generation: 1,
          attemptCount: 1,
          leaseOwner: input.leaseOwner,
          leaseDeadline: input.leaseDeadline,
        };
      },
      renewLifecycleWork: async () => ready,
      settleLifecycleWork: async () => ({ ...ready, state: "succeeded" }),
    },
    handlers: {
      continue_model: async () => {
        modelStarted();
        await modelBlocked;
        return { state: "succeeded" };
      },
      reconcile_conversation: async () => {
        controlStarted();
        return { state: "succeeded" };
      },
    },
  });

  void dispatcher.wake();
  await modelStart;
  queued.set(control.id, control);
  void dispatcher.wake();
  await controlStart;
  releaseModel();
  await dispatcher.settled();
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
