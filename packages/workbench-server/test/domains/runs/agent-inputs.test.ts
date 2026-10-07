import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentInputService,
  type AgentInputQueueState,
  type AgentInputRequest,
  type AgentInputStore,
} from "../../../src/domains/runs/runtime/agent-inputs.js";

class MemoryStore implements AgentInputStore {
  documents = new Map<string, AgentInputQueueState>();
  fail = false;
  nextId = 0;
  async load(id: string) {
    return structuredClone(this.documents.get(id));
  }
  async save(
    id: string,
    state: AgentInputQueueState,
    expectedRevision: number,
  ) {
    if (this.fail) throw new Error("disk failure");
    assert.equal(this.documents.get(id)?.revision ?? 0, expectedRevision);
    this.documents.set(id, structuredClone(state));
  }
}
const agentId = "agent_child";
const conversationId = "conv_shared";
const target = {
  agentId,
  conversationId,
  runId: "run_one",
  attemptId: "exec_one",
  turnId: "turn_one",
};
function fixture(store = new MemoryStore()) {
  return {
    store,
    queue: new AgentInputService(
      store,
      { next: () => String(++store.nextId) },
      { now: () => new Date("2026-10-06T00:00:00Z") },
    ),
  };
}
function request(
  key: string,
  patch: Partial<AgentInputRequest> = {},
): AgentInputRequest {
  return {
    text: key,
    role: "user",
    origin: { kind: "user", userId: "user" },
    idempotencyKey: key,
    eligibility: { kind: "next_turn" },
    activation: "wake_if_idle",
    ...patch,
  };
}
const validate = async () => undefined;

test("durable acceptance is ordered across both lanes, idempotent, and independent of harness", async () => {
  const { queue, store } = fixture();
  const [first, second] = await Promise.all([
    queue.accept(agentId, conversationId, request("user"), validate),
    queue.accept(
      agentId,
      conversationId,
      request("notice", {
        role: "system",
        origin: { kind: "system", producer: "task", correlationId: "task_1" },
        activation: "queue_only",
      }),
      validate,
    ),
  ]);
  assert.equal(first.sequence, 0);
  assert.equal(second.sequence, 1);
  assert.deepEqual(
    await queue.accept(agentId, conversationId, request("user"), validate),
    first,
  );
  const recovered = fixture(store).queue;
  assert.deepEqual(
    (await recovered.list(agentId)).map((input) => input.id),
    [first.id, second.id],
  );
  const inserted: string[] = [];
  await recovered.prepare(
    target,
    async (input) => {
      inserted.push(input.text);
    },
    async () => false,
  );
  assert.deepEqual(inserted, ["user", "notice"]);
  assert.deepEqual(await recovered.list(agentId), []);
});

test("failed persistence never acknowledges acceptance; spoofed system origin rejected", async () => {
  const { queue, store } = fixture();
  store.fail = true;
  await assert.rejects(
    queue.accept(agentId, conversationId, request("lost"), validate),
    /disk failure/,
  );
  store.fail = false;
  assert.deepEqual(await queue.list(agentId), []);
  await assert.rejects(
    queue.accept(
      agentId,
      conversationId,
      request("spoof", { role: "system" }),
      validate,
    ),
    /authenticated system/,
  );
  await queue.accept(agentId, conversationId, request("key"), validate);
  await assert.rejects(
    queue.accept(
      agentId,
      conversationId,
      request("key", { text: "different" }),
      validate,
    ),
    /idempotency/,
  );
});

test("pause survives restart, targeted input expires, deferred input cannot enter current run", async () => {
  const { queue, store } = fixture();
  await queue.accept(agentId, conversationId, request("general"), validate);
  await queue.accept(
    agentId,
    conversationId,
    request("target", { eligibility: { kind: "run", runId: "run_old" } }),
    validate,
  );
  await queue.accept(
    agentId,
    conversationId,
    request("deferred", {
      eligibility: { kind: "next_run", afterRunId: "run_one" },
    }),
    validate,
  );
  await queue.setPaused(agentId, true);
  const recovered = fixture(store).queue;
  assert.equal(await recovered.isPaused(agentId), true);
  assert.deepEqual(
    await recovered.prepare(
      target,
      async () => assert.fail(),
      async () => true,
    ),
    [],
  );
  await recovered.setPaused(agentId, false);
  const delivered: string[] = [];
  await recovered.prepare(
    target,
    async (input) => {
      delivered.push(input.text);
    },
    async () => true,
  );
  assert.deepEqual(delivered, ["general"]);
  assert.deepEqual(
    (await recovered.list(agentId)).map((input) => input.text),
    ["deferred"],
  );
  await recovered.prepare(
    { ...target, runId: "run_two" },
    async (input) => {
      delivered.push(input.text);
    },
    async () => true,
  );
  assert.deepEqual(delivered, ["general", "deferred"]);
});

test("cancellation fences boundary insertion and recovery uses stable insertion identity", async () => {
  const { queue, store } = fixture();
  const cancelled = await queue.accept(
    agentId,
    conversationId,
    request("cancel"),
    validate,
  );
  await queue.cancel(agentId, cancelled.id);
  await queue.prepare(
    target,
    async () => assert.fail(),
    async () => false,
  );
  const input = await queue.accept(
    agentId,
    conversationId,
    request("recover"),
    validate,
  );
  const context = new Map<string, string>();
  await assert.rejects(
    queue.prepare(
      target,
      async (item, id) => {
        context.set(id, item.text);
        store.fail = true; // crash after context insertion, before delivery commit
      },
      async () => false,
    ),
    /disk failure/,
  );
  store.fail = false;
  const recovered = fixture(store).queue;
  await assert.rejects(
    recovered.cancel(agentId, input.id),
    /delivery already claimed/,
  );
  await recovered.prepare(
    target,
    async (item, id) => {
      context.set(id, item.text);
    },
    async () => false,
  );
  assert.equal(context.size, 1);
  assert.equal(
    (await store.load(agentId))?.inputs.at(-1)?.delivery?.contextEntryId,
    `entry_${input.id}`,
  );
});

test("bounded batches preserve fairness and acceptance after final boundary remains pending", async () => {
  const { queue } = fixture();
  for (let index = 0; index < 4; index++)
    await queue.accept(
      agentId,
      conversationId,
      request(String(index)),
      validate,
    );
  assert.equal(
    (
      await queue.prepare(
        target,
        async () => undefined,
        async () => false,
        2,
      )
    ).length,
    2,
  );
  assert.equal(await queue.hasEligible(agentId, target.runId), true);
  await queue.prepare(
    target,
    async () => undefined,
    async () => false,
  );
  assert.equal(await queue.hasEligible(agentId, target.runId), false);
  await queue.accept(agentId, conversationId, request("late"), validate);
  const inserted: string[] = [];
  await queue.prepare(
    { ...target, runId: "run_next" },
    async (input) => {
      inserted.push(input.text);
    },
    async () => true,
  );
  assert.deepEqual(inserted, ["late"]);
});

test("delivery and cancellation race has one winner and concurrent acceptance retains its next boundary", async () => {
  const { queue } = fixture();
  const input = await queue.accept(
    agentId,
    conversationId,
    request("claimed"),
    validate,
  );
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const delivering = queue.prepare(
    target,
    async () => {
      entered();
      await gate;
    },
    async () => false,
  );
  await ready;
  const cancel = assert.rejects(
    queue.cancel(agentId, input.id),
    /Pending input not found/,
  );
  const accept = queue.accept(
    agentId,
    conversationId,
    request("accepted during boundary"),
    validate,
  );
  release();
  await Promise.all([delivering, cancel, accept]);
  assert.deepEqual(
    (await queue.list(agentId)).map((item) => item.text),
    ["accepted during boundary"],
  );
  const inserted: string[] = [];
  await queue.prepare(
    { ...target, turnId: "turn_second" },
    async (item) => {
      inserted.push(item.text);
    },
    async () => false,
  );
  assert.deepEqual(inserted, ["accepted during boundary"]);
});

test("restart repairs a claimed insertion as historical exact-run delivery, never a replacement target", async () => {
  const { queue, store } = fixture();
  const input = await queue.accept(
    agentId,
    conversationId,
    request("targeted", { eligibility: { kind: "run", runId: target.runId } }),
    validate,
  );
  const context = new Set<string>();
  await assert.rejects(
    queue.prepare(
      target,
      async (_item, id) => {
        context.add(id);
        store.fail = true;
      },
      async () => false,
    ),
    /disk failure/,
  );
  store.fail = false;
  const recovered = fixture(store).queue;
  const insertions: string[] = [];
  await recovered.prepare(
    { ...target, runId: "run_replacement", attemptId: "exec_replacement" },
    async (_item, id, insertionTarget) => {
      assert.equal(context.has(id), true);
      insertions.push(insertionTarget.runId);
    },
    async () => true,
    32,
    async (id) => context.has(id),
  );
  assert.deepEqual(insertions, [target.runId]);
  assert.equal(
    (await store.load(agentId))?.inputs.find((item) => item.id === input.id)
      ?.delivery?.runId,
    target.runId,
  );
  assert.deepEqual(await recovered.list(agentId), []);
});

test("claim-before-insertion recovery retargets only general input and expires uninserted run targets", async () => {
  const { queue, store } = fixture();
  const general = await queue.accept(
    agentId,
    conversationId,
    request("general before crash"),
    validate,
  );
  await assert.rejects(
    queue.prepare(
      target,
      async () => {
        throw new Error("crash before insertion");
      },
      async () => false,
    ),
    /crash before insertion/,
  );
  const recovered = fixture(store).queue;
  const replacement = {
    ...target,
    runId: "run_replacement",
    attemptId: "exec_replacement",
    turnId: "turn_replacement",
  };
  await recovered.prepare(
    replacement,
    async (_input, id, claim) => {
      assert.equal(id, `entry_${general.id}`);
      assert.equal(claim.runId, replacement.runId);
    },
    async () => true,
    32,
    async () => false,
  );
  assert.equal(
    (await store.load(agentId))?.inputs[0]?.delivery?.runId,
    replacement.runId,
  );
  const targeted = await recovered.accept(
    agentId,
    conversationId,
    request("target before crash", {
      eligibility: { kind: "run", runId: replacement.runId },
    }),
    validate,
  );
  await assert.rejects(
    recovered.prepare(
      replacement,
      async () => {
        throw new Error("crash before insertion");
      },
      async () => false,
    ),
    /crash before insertion/,
  );
  await recovered.prepare(
    { ...replacement, runId: "run_later" },
    async () => assert.fail("obsolete targeted input must not insert"),
    async () => true,
    32,
    async () => false,
  );
  assert.equal(
    (await store.load(agentId))?.inputs.find(
      (input) => input.id === targeted.id,
    )?.state,
    "obsolete",
  );
});

test("same nonterminal run retry reconciles an uninserted old-attempt claim", async () => {
  const { queue, store } = fixture();
  const input = await queue.accept(
    agentId,
    conversationId,
    request("retry-claim"),
    async () => undefined,
  );
  await assert.rejects(
    queue.prepare(
      target,
      async () => {
        throw new Error("crash before insertion");
      },
      async () => false,
    ),
    /crash/,
  );
  const recovered = fixture(store).queue;
  const retry = { ...target, attemptId: "exec_retry", turnId: "turn_retry" };
  const delivered = await recovered.prepare(
    retry,
    async (_input, _id, actual) => {
      assert.deepEqual(actual, retry);
    },
    async () => false,
    32,
    async () => false,
  );
  assert.equal(delivered[0]?.id, input.id);
  assert.equal(delivered[0]?.delivery?.attemptId, "exec_retry");
});

test("terminal targeted claims settle without a replacement turn, preserving actual inserted history", async () => {
  for (const inserted of [false, true]) {
    const { queue } = fixture();
    const input = await queue.accept(
      agentId,
      conversationId,
      request(`target-${inserted}`, {
        eligibility: { kind: "run", runId: target.runId },
      }),
      async () => undefined,
    );
    await assert.rejects(
      queue.prepare(
        target,
        async () => {
          throw new Error("crash");
        },
        async () => false,
      ),
      /crash/,
    );
    await queue.settleRun(agentId, target.runId, async () => inserted);
    const settled = await queue.get(agentId, input.id);
    assert.equal(settled?.state, inserted ? "delivered" : "obsolete");
    if (inserted) assert.equal(settled?.delivery?.runId, target.runId);
    assert.deepEqual(await queue.list(agentId), []);
  }
});
