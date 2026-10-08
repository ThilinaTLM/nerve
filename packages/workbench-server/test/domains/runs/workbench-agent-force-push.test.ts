import assert from "node:assert/strict";
import test from "node:test";
import { forcePushAgentInputs } from "../../../src/domains/runs/application/workbench-agent-force-push.js";
import {
  AgentInputService,
  type AgentInputQueueState,
} from "../../../src/domains/runs/runtime/agent-inputs.js";
import type { RunHydratedState } from "../../../src/domains/runs/runtime/index.js";

type Deps = Parameters<typeof forcePushAgentInputs>[0];
async function fixture() {
  let document: AgentInputQueueState | undefined;
  const inputs = new AgentInputService(
    {
      load: async () => structuredClone(document),
      save: async (_id, value, revision) => {
        assert.equal(document?.revision ?? 0, revision);
        document = structuredClone(value);
      },
    },
    { next: () => "one" },
    { now: () => new Date("2026-10-08T00:00:00Z") },
  );
  await inputs.accept(
    "agent_one",
    "conv_one",
    {
      text: "urgent",
      role: "user",
      origin: { kind: "user", userId: "u" },
      idempotencyKey: "one",
      eligibility: { kind: "next_turn" },
      activation: "wake_if_idle",
    },
    async () => {},
  );
  const run = {
    runId: "run_one",
    agentId: "agent_one",
    executionId: "attempt_one",
  };
  const deps = {
    inputs,
    findActive: async () => ({ run }) as RunHydratedState,
    withControl: async <T>(action: () => Promise<T>) => action(),
    coordinator: undefined as unknown as Deps["coordinator"],
  };
  return { deps, run, inputs };
}

test("force-push rejects a replacement attempt before committing intent or signalling", async () => {
  const { deps, run, inputs } = await fixture();
  deps.coordinator = {
    interruptTurn: async (_id, before) => {
      await before!({ ...run, executionId: "attempt_replacement" } as never);
      assert.fail("must reject stale control before signalling");
    },
  } as Deps["coordinator"];
  await assert.rejects(
    forcePushAgentInputs(deps, "agent_one", "push_one"),
    /active execution changed/,
  );
  assert.equal(
    (await inputs.list("agent_one"))[0]?.interruptionRequested,
    undefined,
  );
});

test("persisted but unsignalled force-push can be retried; successful repeated requests do not reinterrupt", async () => {
  const { deps, run, inputs } = await fixture();
  let signals = 0;
  let fail = true;
  deps.coordinator = {
    interruptTurn: async (_id, before) => {
      const requested = await before!({ ...run } as never);
      if (requested === false) return;
      if (fail) {
        fail = false;
        throw new Error("lost before signal");
      }
      signals++;
    },
  } as Deps["coordinator"];
  await assert.rejects(
    forcePushAgentInputs(deps, "agent_one", "push_one"),
    /lost before signal/,
  );
  const accepted = await forcePushAgentInputs(deps, "agent_one", "push_one");
  assert.equal(signals, 1);
  assert.deepEqual(
    await forcePushAgentInputs(deps, "agent_one", "push_one"),
    accepted,
  );
  assert.equal(signals, 1);
  assert.equal((await inputs.list("agent_one"))[0]?.state, "pending");
});

test("force-push cannot bypass a preprocessing approval or uncertain-effect recovery boundary", async () => {
  const { deps, run, inputs } = await fixture();
  const guarded = { ...deps, canInterrupt: async () => false };
  guarded.coordinator = {
    interruptTurn: async (_id, before) => {
      await before!({ ...run } as never);
      assert.fail("blocked interactions must not be signalled");
    },
  } as Deps["coordinator"];
  await assert.rejects(
    forcePushAgentInputs(guarded, "agent_one", "push_one"),
    /pending interactions or recovery/,
  );
  assert.equal(
    (await inputs.list("agent_one"))[0]?.interruptionRequested,
    undefined,
  );
});
