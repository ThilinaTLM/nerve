import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./agent-controls.fixture.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("shutdown cancels both nonterminal admission watchers without pausing or discarding durable input", async () => {
  const h = fixture();
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  const accepted = await h.service.promptAgent(h.agent.id, {
    text: "pending next turn",
  });
  await h.service.settledAdmissions();
  const list = h.inputs.list.bind(h.inputs);
  let reads = 0;
  h.inputs.list = async (...args) => {
    reads++;
    return list(...args);
  };
  h.service.stopAdmissions();
  await h.service.settledInputWork();
  const readsAtClose = reads;
  h.runs.get("run_1")!.run.status = "completed";
  await h.service.recoverAgentInputs();
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  await delay(60);
  assert.equal(reads, readsAtClose);
  assert.equal(h.starts.length, 1);
  assert.equal(await h.inputs.isPaused(h.agent.id), false);
  assert.equal((await list(h.agent.id))[0]?.id, accepted?.id);
  assert.equal((await list(h.agent.id))[0]?.state, "pending");
});

test("shutdown drains an already-running settlement and fences its follow-on recovery", async () => {
  const h = fixture();
  const entered = gate(),
    settlement = gate();
  const settle = h.inputs.settleRun.bind(h.inputs);
  h.inputs.settleRun = async (...args) => {
    entered.release();
    await settlement.promise;
    return settle(...args);
  };
  let recoveryCalls = 0;
  h.service.recoverAgentInputs = async () => {
    recoveryCalls++;
  };
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  h.runs.get("run_1")!.run.status = "completed";
  // Keep a ref'ed deadline while the detached watcher's poll timer is unref'ed.
  await Promise.race([
    entered.promise,
    delay(1_000).then(() => assert.fail("watcher did not settle")),
  ]);
  h.service.stopAdmissions();
  let drained = false;
  const drain = h.service.settledInputWork().then(() => {
    drained = true;
  });
  await delay(0);
  assert.equal(drained, false);
  settlement.release();
  await drain;
  assert.equal(recoveryCalls, 0);
});

test("shutdown fences an admission already waiting at the coordinator commit boundary", async () => {
  const h = fixture();
  const entered = gate(),
    admission = gate();
  h.beforeStart(async () => {
    entered.release();
    await admission.promise;
  });
  const waking = h.service.wakeAgentFromHarness(h.agent.id, true);
  await entered.promise;
  h.service.stopAdmissions();
  let drained = false;
  const drain = h.service.settledInputWork().then(() => {
    drained = true;
  });
  await delay(0);
  assert.equal(drained, false);
  admission.release();
  await assert.rejects(
    waking,
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "RUNTIME_SHUTTING_DOWN",
  );
  await drain;
  assert.deepEqual(h.starts, []);
  assert.equal(await h.inputs.admissionBlocker(h.agent.id), undefined);
  assert.equal(await h.inputs.isPaused(h.agent.id), false);
});

test("shutdown drains in-flight input recovery before teardown", async () => {
  const h = fixture();
  const entered = gate(),
    reading = gate();
  const generation = h.inputs.controlGeneration.bind(h.inputs);
  h.inputs.controlGeneration = async (agentId) => {
    entered.release();
    await reading.promise;
    return generation(agentId);
  };
  const recovery = h.service.recoverAgentInputs();
  await entered.promise;
  h.service.stopAdmissions();
  let drained = false;
  const drain = h.service.settledInputWork().then(() => {
    drained = true;
  });
  await delay(0);
  assert.equal(drained, false);
  reading.release();
  await recovery;
  await drain;
  assert.deepEqual(h.starts, []);
});

for (const phase of ["acceptance", "observer"] as const) {
  test(`shutdown drains the whole enqueue operation held in ${phase}`, async () => {
    const entered = gate(),
      operation = gate();
    let closed = false;
    const h = fixture({
      inputAccepted: async () => {
        if (phase !== "observer") return;
        entered.release();
        await operation.promise;
        assert.equal(closed, false, "observer ran after close");
      },
    });
    const accept = h.inputs.accept.bind(h.inputs);
    let attempts = 0;
    h.inputs.accept = async (...args) => {
      attempts++;
      if (phase === "acceptance") {
        entered.release();
        await operation.promise;
      }
      assert.equal(closed, false, "acceptance wrote after close");
      return accept(...args);
    };
    const enqueue = () =>
      h.service.enqueueAgentInput(h.agent.id, {
        text: "accepted before shutdown",
        role: "user",
        origin: { kind: "user", userId: "authorized" },
        idempotencyKey: phase,
        eligibility: { kind: "next_turn" },
        activation: "wake_if_idle",
      });
    const accepting = enqueue();
    await entered.promise;
    h.service.stopAdmissions();
    let drained = false;
    const drain = h.service.settledInputWork().then(() => {
      drained = true;
      closed = true;
    });
    await delay(0);
    assert.equal(drained, false);
    operation.release();
    const receipt = await accepting;
    await drain;
    await assert.rejects(enqueue(), { code: "RUNTIME_SHUTTING_DOWN" });
    assert.equal(attempts, 1);
    assert.deepEqual(h.starts, []);
    assert.equal((await h.inputs.list(h.agent.id))[0]?.id, receipt.id);
    assert.equal((await h.inputs.list(h.agent.id))[0]?.state, "pending");
  });
}

test("shutdown drains a submission storage read and terminates pending admission polling without cancelling its input", async () => {
  const h = fixture();
  await h.service.abortAgent(h.agent.id);
  const entered = gate(),
    reading = gate();
  let closed = false,
    reads = 0;
  const get = h.inputs.get.bind(h.inputs);
  h.inputs.get = async (...args) => {
    reads++;
    entered.release();
    await reading.promise;
    assert.equal(closed, false, "submission read after close");
    return get(...args);
  };
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "survive pending submission",
  );
  const rejected = assert.rejects(submitting, {
    code: "RUNTIME_SHUTTING_DOWN",
  });
  await entered.promise;
  h.service.stopAdmissions();
  let drained = false;
  const drain = h.service.settledInputWork().then(() => {
    drained = true;
    closed = true;
  });
  await delay(0);
  assert.equal(drained, false);
  reading.release();
  await rejected;
  await drain;
  const readsAtClose = reads;
  await delay(60);
  assert.equal(reads, readsAtClose);
  assert.equal((await h.inputs.list(h.agent.id))[0]?.state, "pending");
  assert.deepEqual(h.starts, []);
});

for (const state of ["paused", "suspended"] as const) {
  test(`shutdown cancels submission polling while the agent is ${state}`, async () => {
    const h = fixture();
    if (state === "paused") await h.service.abortAgent(h.agent.id);
    else {
      await h.service.wakeAgentFromHarness(h.agent.id, true);
      h.runs.get("run_1")!.run.status = "suspended";
    }
    const entered = gate();
    const get = h.inputs.get.bind(h.inputs);
    let reads = 0;
    h.inputs.get = async (...args) => {
      reads++;
      entered.release();
      return get(...args);
    };
    const submitting = h.service.submitAgentRun(
      h.agent.id,
      "durable pending assignment",
    );
    const rejected = assert.rejects(submitting, {
      code: "RUNTIME_SHUTTING_DOWN",
    });
    await entered.promise;
    await delay(0);
    h.service.stopAdmissions();
    await h.service.settledInputWork();
    await rejected;
    const readsAtClose = reads;
    await delay(60);
    assert.equal(reads, readsAtClose);
    assert.equal((await h.inputs.list(h.agent.id))[0]?.state, "pending");
    assert.equal(h.starts.length, state === "paused" ? 0 : 1);
  });
}

test("legitimate detached settlement failures remain observable", async (t) => {
  const warnings: string[] = [];
  t.mock.method(process, "emitWarning", (warning: string | Error) => {
    warnings.push(String(warning));
  });
  const h = fixture();
  h.inputs.settleRun = async () => {
    throw new Error("settlement storage failure");
  };
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  h.runs.get("run_1")!.run.status = "completed";
  await delay(60);
  h.service.stopAdmissions();
  await h.service.settledInputWork();
  assert.ok(
    warnings.some((warning) => warning.includes("settlement storage failure")),
  );
});

test("runtime lifecycle drains detached admission reads before canonical close and retains queued input", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-input-shutdown-"));
  const storage = await initializeStorage(home);
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  let closed = false,
    staleReads = 0;
  const close = storage.canonicalStore.close.bind(storage.canonicalStore);
  storage.canonicalStore.close = async () => {
    closed = true;
    await close();
  };
  const load = runtime.services.runRuntime.unitOfWork.loadFresh.bind(
    runtime.services.runRuntime.unitOfWork,
  );
  runtime.services.runRuntime.unitOfWork.loadFresh = async (runId) => {
    if (closed) staleReads++;
    return load(runId);
  };
  try {
    await runtime.lifecycle.hydrate();
    // Leave durable work nonterminal; shutdown must cancel pollers, not wait
    // forever for a paused dispatcher or mutate the user's activation state.
    runtime.services.lifecycleDispatcher.stop();
    await runtime.services.lifecycleDispatcher.settled();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider: "shutdown-test", modelId: "not-dispatched" },
    });
    const accepted = await runtime.services.workbenchRun.promptAgent(agent.id, {
      text: "survive shutdown",
    });
    await runtime.services.workbenchRun.settledAdmissions();
    assert.ok(
      await runtime.services.runRuntime.unitOfWork.findActive(
        `${conversation.id}:${agent.id}`,
      ),
    );
    const before = await storage.canonicalStore.readDocument(
      "agent_inputs",
      "global",
      agent.id,
    );
    await shutdownServerRuntime(runtime.runtime);
    assert.equal(closed, true);
    await runtime.services.workbenchRun.recoverAgentInputs();
    await runtime.services.workbenchRun.wakeAgentFromHarness(agent.id);
    await delay(75);
    assert.equal(staleReads, 0);
    assert.equal(
      runtime.services.agentLifecycle.getAgent(agent.id).activationState,
      "enabled",
    );
    const restored = await initializeStorage(home);
    try {
      const after = await restored.canonicalStore.readDocument(
        "agent_inputs",
        "global",
        agent.id,
      );
      assert.deepEqual(after?.data, before?.data);
      assert.ok(JSON.stringify(after?.data).includes(accepted!.id));
    } finally {
      await restored.canonicalStore.close();
    }
  } finally {
    if (!closed) await shutdownServerRuntime(runtime.runtime);
    await rm(home, { recursive: true, force: true });
  }
});
