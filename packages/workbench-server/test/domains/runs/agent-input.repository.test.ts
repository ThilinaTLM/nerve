import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";
import { AgentInputService } from "../../../src/domains/runs/runtime/agent-inputs.js";

test("canonical agent input acceptance, pause, and insertion claims survive reopening storage", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-inputs-"));
  let canonical = new CanonicalStore(join(home, "canonical.sqlite"), {
    readerCount: 0,
  });
  await canonical.initialize();
  const createQueue = () =>
    new AgentInputService(
      new AgentInputRepository({ canonicalStore: canonical }),
      { next: randomUUID },
      { now: () => new Date() },
    );
  const queue = createQueue();
  const request = {
    text: "persist me",
    role: "user" as const,
    origin: { kind: "user" as const, userId: "authorized" },
    idempotencyKey: "request-one",
    eligibility: { kind: "next_turn" as const },
    activation: "wake_if_idle" as const,
  };
  try {
    const accepted = await queue.accept(
      "agent_one",
      "conv_shared",
      request,
      async () => undefined,
    );
    await queue.setPaused("agent_one", true);
    await canonical.close();
    canonical = new CanonicalStore(join(home, "canonical.sqlite"), {
      readerCount: 0,
    });
    await canonical.initialize();
    const recovered = createQueue();
    assert.equal(await recovered.isPaused("agent_one"), true);
    assert.equal((await recovered.list("agent_one"))[0]?.id, accepted.id);
    assert.equal(
      (
        await recovered.accept("agent_one", "conv_shared", request, async () =>
          assert.fail("duplicate target revalidation"),
        )
      ).id,
      accepted.id,
    );
    await recovered.setPaused("agent_one", false);
    await recovered.prepare(
      {
        agentId: "agent_one",
        conversationId: "conv_shared",
        runId: "run_new",
        attemptId: "exec_new",
        turnId: "prepared_new",
      },
      async (_input, contextEntryId) => {
        assert.equal(contextEntryId, `entry_${accepted.id}`);
      },
      async () => false,
    );
    await recovered.bindTurn("agent_one", "prepared_new", "turn_actual");
    await canonical.close();
    canonical = new CanonicalStore(join(home, "canonical.sqlite"), {
      readerCount: 0,
    });
    await canonical.initialize();
    assert.deepEqual(await createQueue().list("agent_one"), []);
    const persisted = await new AgentInputRepository({
      canonicalStore: canonical,
    }).load("agent_one");
    assert.equal(persisted?.inputs[0]?.delivery?.turnId, "turn_actual");
    assert.deepEqual(await createQueue().list("agent_sibling"), []);
    const undispatched = createQueue();
    assert.equal(await undispatched.hasContextPending("agent_one"), true);
    await undispatched.setPaused("agent_one", true);
    await canonical.close();
    canonical = new CanonicalStore(join(home, "canonical.sqlite"), {
      readerCount: 0,
    });
    await canonical.initialize();
    const resumed = createQueue();
    assert.equal(await resumed.hasContextPending("agent_one"), true);
    await resumed.setPaused("agent_one", false, true);
    assert.equal(
      await resumed.hasWakeRequest("agent_one"),
      true,
      "delivered context remains eligible despite an empty pending queue",
    );
    await resumed.recordProviderDispatch("agent_one");
    assert.equal(await resumed.hasContextPending("agent_one"), false);
    assert.equal(await resumed.hasWakeRequest("agent_one"), false);
  } finally {
    await canonical.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("corrupt queue envelopes fail closed on reload without erasing data", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-402-corruption-"));
  const canonical = new CanonicalStore(join(home, "canonical.sqlite"), {
    readerCount: 0,
  });
  await canonical.initialize();
  try {
    const repository = new AgentInputRepository({ canonicalStore: canonical });
    const queue = new AgentInputService(
      repository,
      { next: randomUUID },
      { now: () => new Date() },
    );
    const input = await queue.accept(
      "agent_one",
      "conv_shared",
      {
        text: "unchanged",
        role: "user",
        origin: { kind: "user", userId: "user" },
        idempotencyKey: "original",
        eligibility: { kind: "next_turn" },
        activation: "queue_only",
      },
      async () => undefined,
    );
    const original = (await repository.load("agent_one"))!;
    const corruptions = [
      { ...original, nextSequence: 0 },
      { ...original, controlGeneration: -1 },
      { ...original, inputs: [...original.inputs, ...original.inputs] },
      {
        ...original,
        insertionClaims: {
          [input.id]: {
            agentId: "agent_other",
            conversationId: "conv_shared",
            runId: "run_old",
            attemptId: "exec_old",
            turnId: "turn_old",
          },
        },
      },
    ];
    let revision = original.revision;
    for (const corrupt of corruptions) {
      const data = { ...corrupt, revision: revision + 1 };
      await canonical.writeDocument({
        namespace: "agent_inputs",
        scopeId: "global",
        documentId: "agent_one",
        data,
        expectedRevision: revision++,
        now: new Date().toISOString(),
      });
      await assert.rejects(repository.load("agent_one"));
      let inserted = false;
      await assert.rejects(
        queue.prepare(
          {
            agentId: "agent_one",
            conversationId: "conv_shared",
            runId: "run_new",
            attemptId: "exec_new",
            turnId: "turn_new",
          },
          async () => {
            inserted = true;
          },
          async () => false,
        ),
      );
      assert.equal(inserted, false);
      const persisted = await canonical.readDocument<{ inputs: unknown[] }>(
        "agent_inputs",
        "global",
        "agent_one",
      );
      assert.equal(persisted?.data.inputs.length, data.inputs.length);
    }
  } finally {
    await canonical.close();
    await rm(home, { recursive: true, force: true });
  }
});
