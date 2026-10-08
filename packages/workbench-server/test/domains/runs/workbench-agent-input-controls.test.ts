import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../../src/core/application-error.js";
import { fixture } from "./agent-controls.fixture.js";

test("direct child prompt uses durable shared controls; stop preserves queued input and stale wake cannot reactivate", async () => {
  const harness = fixture();
  await harness.service.abortAgent(harness.agent.id);
  await harness.service.promptAgent(harness.agent.id, {
    text: "user steering",
  });
  assert.equal(harness.starts.length, 0);
  assert.equal(
    (await harness.inputs.list(harness.agent.id))[0]?.text,
    "user steering",
  );
  await harness.service.wakeAgentFromHarness(harness.agent.id);
  assert.equal(harness.starts.length, 0);
  await harness.service.resumeAgent(harness.agent.id);
  await harness.service.settledAdmissions();
  assert.equal(harness.starts.length, 1);
  await harness.service.abortAgent(harness.agent.id);
});

test("wake racing stop is serialized and does not leave an admitted execution unpaused", async () => {
  const harness = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.beforeStart(() => gate);
  const wake = harness.service.wakeAgentFromHarness(harness.agent.id, true);
  await new Promise((resolve) => setImmediate(resolve));
  const stop = harness.service.abortAgent(harness.agent.id);
  release();
  const results = await Promise.allSettled([wake, stop]);
  assert.equal(results[0]?.status, "rejected");
  assert.equal(results[1]?.status, "fulfilled");
  assert.equal(harness.starts.length, 0);
  assert.equal(await harness.inputs.isPaused(harness.agent.id), true);
  await harness.service.wakeAgentFromHarness(harness.agent.id);
  assert.equal(harness.starts.length, 0);
});

test("suspended and interrupted agents accept steering without automatic continuation", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  harness.runs.get("run_1")!.run.status = "interrupted";
  await harness.service.promptAgent(harness.agent.id, {
    text: "do not replay uncertain effects",
  });
  assert.equal((await harness.inputs.list(harness.agent.id)).length, 1);
  assert.deepEqual(harness.continues, []);
  await harness.service.resumeAgent(harness.agent.id);
  assert.deepEqual(harness.continues, ["run_1"]);
  harness.runs.get("run_1")!.run.status = "completed";
});

test("exact-run completion returns original response and stale cancellation does not pause replacement", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  harness.runs.get("run_1")!.run.status = "completed";
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  const completion = await harness.service.waitForAgentRun({
    agentId: harness.agent.id,
    runId: "run_1",
    attemptId: "exec_1",
  });
  assert.equal(completion.response?.text, "original response");
  await harness.service.abortRun({ agentId: harness.agent.id, runId: "run_1" });
  assert.equal(harness.agent.activationState, "enabled");
  assert.equal(harness.runs.get("run_2")!.run.status, "running");
  await harness.service.abortAgent(harness.agent.id);
});

test("acceptance receipt survives observer and admission-policy failures", async () => {
  const harness = fixture({
    inputAccepted: async () => {
      throw new Error("notification persistence unavailable");
    },
    admissionPolicy: {
      reserve: async () => {
        throw new Error("team capacity exhausted");
      },
      committed: async () => assert.fail("no canonical run"),
      released: async () => undefined,
    },
  });
  const accepted = await harness.service.promptAgent(harness.agent.id, {
    text: "durably accepted assignment",
  });
  assert.ok(accepted);
  await harness.service.settledAdmissions();
  assert.equal(
    (await harness.inputs.list(harness.agent.id))[0]?.id,
    accepted.id,
  );
  assert.equal(harness.starts.length, 0);
  assert.match(
    (await harness.inputs.admissionBlocker(harness.agent.id))?.message ?? "",
    /team capacity exhausted/,
  );
});

test("later stop fences an interrupt waiting for detached execution settlement", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  harness.settledForAgent(async () => {
    entered();
    await gate;
  });
  const replacing = harness.service.interruptAgent(harness.agent.id, {
    text: "replacement",
  });
  await ready;
  await harness.service.abortAgent(harness.agent.id);
  release();
  await replacing;
  assert.equal(await harness.inputs.isPaused(harness.agent.id), true);
  assert.equal(harness.starts.length, 1);
  assert.deepEqual(await harness.inputs.list(harness.agent.id), []);
});

test("unknown or mismatched exact-run cancellation has no activation side effects", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  await assert.rejects(
    harness.service.abortRun({
      agentId: harness.agent.id,
      runId: "run_missing",
    }),
    /Run not found/,
  );
  harness.runs.get("run_1")!.run.agentId = "agent_sibling";
  await assert.rejects(
    harness.service.abortRun({ agentId: harness.agent.id, runId: "run_1" }),
    /Run not found/,
  );
  assert.equal(await harness.inputs.isPaused(harness.agent.id), false);
  assert.equal(harness.agent.activationState, "enabled");
  assert.equal(harness.runs.get("run_1")!.run.status, "running");
});

test("settlement between wake and active-run lookup cannot strand accepted general input", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  let reads = 0;
  harness.beforeFindActive(() => {
    reads++;
    if (reads === 2) harness.runs.get("run_1")!.run.status = "completed";
  });
  await harness.service.enqueueAgentInput(harness.agent.id, {
    text: "final response race",
    role: "user",
    origin: { kind: "user", userId: "authorized" },
    idempotencyKey: "final-race",
    eligibility: { kind: "next_turn" },
    activation: "wake_if_idle",
  });
  await harness.service.settledAdmissions();
  assert.equal(harness.starts.length, 2);
  assert.equal(harness.runs.get("run_2")!.run.status, "running");
  await harness.service.abortAgent(harness.agent.id);
});

test("legacy pending prompts transfer once before new lanes, with follow-up eligibility and cancellation mapping", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  const state = harness.runs.get("run_1")!;
  state.prompts = [
    {
      id: "promptq_legacy",
      agentId: harness.agent.id,
      conversationId: harness.agent.conversationId,
      projectId: harness.agent.projectId,
      runId: "run_1",
      behavior: "steer",
      text: "old accepted steer",
      status: "accepted",
      ordinal: 0,
      deliveryAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  await harness.service.migrateLegacyInputs();
  await harness.service.migrateLegacyInputs();
  assert.equal(state.prompts[0]?.status, "cancelled");
  await harness.service.enqueueAgentInput(harness.agent.id, {
    text: "new notice",
    role: "system",
    origin: { kind: "system", producer: "task", correlationId: "task_one" },
    idempotencyKey: "new-notice",
    eligibility: { kind: "next_turn" },
    activation: "queue_only",
  });
  const pending = await harness.inputs.list(harness.agent.id);
  assert.deepEqual(
    pending.map((input) => input.text),
    ["old accepted steer", "new notice"],
  );
  assert.deepEqual(pending[0]?.eligibility, { kind: "run", runId: "run_1" });
  assert.deepEqual(pending[0]?.origin, {
    kind: "system",
    producer: "recovery",
    correlationId: "legacy:promptq_legacy",
  });
  await harness.service.cancelQueuedPrompt(harness.agent.id, "promptq_legacy");
  assert.deepEqual(
    (await harness.inputs.list(harness.agent.id)).map((input) => input.text),
    ["new notice"],
  );
  await harness.service.abortAgent(harness.agent.id);
});

test("persisted prompt acknowledgement does not wait for admission or live harness lifetime", async () => {
  const harness = fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  harness.beforeStart(async () => {
    entered();
    await gate;
  });
  const accepted = await harness.service.promptAgent(harness.agent.id, {
    text: "accepted before harness starts",
  });
  await ready;
  assert.ok(accepted);
  assert.equal(harness.starts.length, 0);
  assert.equal(
    (await harness.inputs.list(harness.agent.id))[0]?.id,
    accepted.id,
  );
  release();
  await harness.service.settledAdmissions();
  assert.equal(harness.starts.length, 1);
  await harness.service.abortAgent(harness.agent.id);
});

test("child approval checkpoint ownership uses the child's context leaf, not the shared lead branch", async () => {
  let leaf = "entry_child_assistant";
  const entries = [
    {
      id: "entry_child_prompt",
      conversationId: "conv_shared",
      agentId: "agent_child",
      runId: "run_1",
      role: "user" as const,
      kind: "message" as const,
      text: "child assignment",
      createdAt: new Date().toISOString(),
    },
    {
      id: "entry_child_assistant",
      conversationId: "conv_shared",
      agentId: "agent_child",
      runId: "run_1",
      parentEntryId: "entry_child_prompt",
      role: "assistant" as const,
      kind: "message" as const,
      text: "requires approval",
      createdAt: new Date().toISOString(),
    },
  ];
  const harness = fixture({
    getAgentHistory: async () => entries,
    getAgentActiveEntryId: async () => leaf,
  });
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  const state = {
    run: harness.runs.get("run_1")!.run,
    checkpoints: [
      {
        checkpointId: "checkpoint_child",
        entryIds: entries.map((entry) => entry.id),
      },
    ],
    interactions: [],
  };
  await harness.service.assertCheckpointOnActiveBranch(
    state as never,
    "checkpoint_child",
  );
  leaf = "entry_root_leaf";
  await assert.rejects(
    harness.service.assertCheckpointOnActiveBranch(
      state as never,
      "checkpoint_child",
    ),
    /conversation changed/,
  );
  await harness.service.abortAgent(harness.agent.id);
});

test("stale targeted cancellation rechecks settlement inside control/transition fence", async () => {
  const h = fixture();
  await h.service.promptAgent(h.agent.id, { text: "old" });
  await h.service.settledAdmissions();
  h.beforeRunControl(async () => {
    const old = h.runs.get("run_1")!;
    old.run.status = "completed";
    h.runs.set("run_replacement", {
      run: {
        ...old.run,
        runId: "run_replacement",
        executionId: "exec_new",
        status: "running",
      },
    });
  });
  await h.service.abortRun({ agentId: h.agent.id, runId: "run_1" });
  assert.equal(h.agent.activationState, "enabled");
  assert.equal(await h.inputs.isPaused(h.agent.id), false);
  assert.equal(h.runs.get("run_replacement")?.run.status, "running");
});

test("public same-key retries retain one durable input and submitted capacity waiting retains one identity", async () => {
  const plain = fixture();
  await plain.service.promptAgent(plain.agent.id, {
    text: "same",
    idempotencyKey: "caller-key",
  });
  await plain.service.promptAgent(plain.agent.id, {
    text: "same",
    idempotencyKey: "caller-key",
  });
  assert.equal((await plain.inputs.list(plain.agent.id)).length, 1);
  let capacity = true;
  const h = fixture({
    admissionPolicy: {
      reserve: async () => {
        if (capacity)
          throw new ApplicationError(409, "SUBAGENT_CAPACITY", "occupied");
      },
      committed: async () => undefined,
      released: async () => undefined,
    },
  });
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "assignment",
    { agentId: "agent_parent", runId: "run_parent" },
    { idempotencyKey: "assignment-key" },
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  const accepted = (await h.inputs.list(h.agent.id))[0]!;
  assert.ok(accepted);
  assert.equal(h.starts.length, 0);
  // Neither acceptance nor controls wait for a capacity reservation.
  await h.service.enqueueAgentInput(h.agent.id, {
    text: "steer",
    role: "user",
    origin: { kind: "user", userId: "user" },
    idempotencyKey: "steer",
    eligibility: { kind: "next_turn" },
    activation: "queue_only",
  });
  capacity = false;
  const identity = await submitting;
  assert.equal(h.runs.get(identity.runId)?.run.initialInputId, accepted.id);
  assert.equal(
    (await h.inputs.list(h.agent.id)).filter(
      (input) => input.idempotencyKey === "assignment-key",
    ).length,
    1,
  );
});

test("attached parent cancellation while capacity pending cancels that input, never later admits an orphan", async () => {
  const h = fixture({
    admissionPolicy: {
      reserve: async () => {
        throw new ApplicationError(409, "SUBAGENT_CAPACITY", "occupied");
      },
      committed: async () => undefined,
      released: async () => undefined,
    },
  });
  const abort = new AbortController();
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "pending Explore",
    { agentId: "agent_parent", runId: "run_parent" },
    { signal: abort.signal, idempotencyKey: "cancel-pending" },
  );
  const rejected = assert.rejects(submitting, /parent cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 40));
  abort.abort(new Error("parent cancelled"));
  await rejected;
  assert.deepEqual(await h.inputs.list(h.agent.id), []);
  await h.service.recoverAgentInputs();
  await h.service.settledAdmissions();
  assert.equal(h.starts.length, 0);
});

test("failed old configuration cannot poison a newer valid revision during settlement", async () => {
  const h = fixture();
  Object.assign(h.agent, { configurationRevision: 1 });
  h.beforeStart(async () => {
    if (h.starts.length === 0) {
      await h.inputs.recordAdmissionBlocker(h.agent.id, "cfg1 unsupported", 1);
      Object.assign(h.agent, { configurationRevision: 2 });
    }
  });
  await h.service.promptAgent(h.agent.id, {
    text: "waiting for configuration",
  });
  await h.service.settledAdmissions();
  h.runs.get("run_1")!.run.status = "failed";
  assert.equal(
    (await h.inputs.admissionBlocker(h.agent.id))?.configurationRevision,
    1,
  );
  await h.service.wakeAgentFromHarness(h.agent.id);
  await h.service.wakeAgentFromHarness(h.agent.id);
  assert.equal(h.starts.length, 2);
  assert.equal(await h.inputs.admissionBlocker(h.agent.id), undefined);
});

test("only explicit administrative resume supplies generation-bound admission proof, never input role", async () => {
  const proofs: Array<{
    agentId: string;
    generation: number;
    cause: string;
    runId?: string;
  }> = [];
  const h = fixture({
    admissionPolicy: {
      recordAdministrativeActivation: async (proof) => {
        proofs.push(proof);
      },
      reserve: async () => undefined,
      committed: async () => undefined,
      released: async () => undefined,
    },
  });
  await h.service.promptAgent(h.agent.id, {
    text: "user role is not control authority",
  });
  await h.service.settledAdmissions();
  assert.deepEqual(proofs, []);
  await h.service.resumeAgent(h.agent.id);
  assert.deepEqual(proofs, []);
  await h.service.resumeAgent(h.agent.id, undefined, {
    authority: "user_administration",
  });
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0]?.agentId, h.agent.id);
  assert.equal(
    proofs[0]?.generation,
    await h.inputs.controlGeneration(h.agent.id),
  );
  assert.equal(proofs[0]?.cause, "user_resume");
  assert.equal(proofs[0]?.runId, h.starts[0]);
  await h.service.abortAgent(h.agent.id);
  assert.notEqual(
    proofs[0]?.generation,
    await h.inputs.controlGeneration(h.agent.id),
    "later stop fences persisted administrative intent",
  );
});

test("startup transfer includes terminal-run deferred followups, before newly accepted input", async () => {
  const h = fixture();
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  const old = h.runs.get("run_1")!;
  old.run.status = "completed";
  old.prompts = [
    {
      id: "promptq_terminal_followup",
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      projectId: h.agent.projectId,
      runId: "run_1",
      behavior: "follow-up",
      text: "older deferred followup",
      status: "accepted",
      ordinal: 1,
      deliveryAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  await h.service.migrateLegacyInputs();
  await h.service.enqueueAgentInput(h.agent.id, {
    text: "new user",
    role: "user",
    origin: { kind: "user", userId: "user" },
    idempotencyKey: "new",
    eligibility: { kind: "next_turn" },
    activation: "queue_only",
  });
  const pending = await h.inputs.list(h.agent.id);
  assert.equal(pending[0]?.text, "older deferred followup");
  assert.deepEqual(pending[0]?.eligibility, { kind: "next_turn" });
  assert.equal(pending[1]?.text, "new user");
  assert.equal(old.prompts[0]?.status, "cancelled");
  await h.service.migrateLegacyInputs();
  assert.equal((await h.inputs.list(h.agent.id)).length, 2);
});

test("submission to a busy agent binds the same input's actual delivery run and attempt", async () => {
  const h = fixture();
  await h.service.promptAgent(h.agent.id, { text: "original" });
  await h.service.settledAdmissions();
  await h.inputs.prepare(
    {
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      runId: "run_1",
      attemptId: "exec_1",
      turnId: "turn_initial",
    },
    async () => undefined,
    async () => false,
  );
  await h.inputs.recordProviderDispatch(h.agent.id);
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "next assignment",
    { agentId: "agent_parent" },
    { idempotencyKey: "busy-submission" },
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(h.starts.length, 1);
  const pending = (await h.inputs.list(h.agent.id))[0]!;
  await h.inputs.prepare(
    {
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      runId: "run_1",
      attemptId: "exec_continued",
      turnId: "turn_continued",
    },
    async () => undefined,
    async () => false,
  );
  const identity = await submitting;
  assert.equal(identity.runId, "run_1");
  assert.equal(identity.attemptId, "exec_continued");
  assert.equal(
    (await h.inputs.get(h.agent.id, pending.id))?.delivery?.runId,
    identity.runId,
  );
  assert.equal(
    h.starts.length,
    1,
    "no replacement/resubmission merely because the agent was busy",
  );
});

test("parent interruption is plain steering, not CLI administration; same-key administrative retries do not cancel replacement", async () => {
  for (const user of [false, true]) {
    const h = fixture();
    await h.service.promptAgent(h.agent.id, { text: "original" });
    await h.service.settledAdmissions();
    await h.inputs.prepare(
      {
        agentId: h.agent.id,
        conversationId: h.agent.conversationId,
        runId: "run_1",
        attemptId: "exec_1",
        turnId: "turn_1",
      },
      async () => undefined,
      async () => false,
    );
    await h.inputs.recordProviderDispatch(h.agent.id);
    const options = user
      ? { authority: "user_administration" as const }
      : { parent: { agentId: "agent_parent", runId: "run_parent" } };
    await h.service.interruptAgent(
      h.agent.id,
      { text: "!echo deliberate", idempotencyKey: "interrupt-key" },
      options,
    );
    await h.service.settledAdmissions();
    assert.equal(h.commandPrompts[1], user ? "!echo deliberate" : undefined);
    const generation = await h.inputs.controlGeneration(h.agent.id);
    await h.service.interruptAgent(
      h.agent.id,
      { text: "!echo deliberate", idempotencyKey: "interrupt-key" },
      options,
    );
    assert.equal(await h.inputs.controlGeneration(h.agent.id), generation);
    assert.equal(h.runs.get("run_2")?.run.status, "running");
  }
});

test("followup and reject-if-busy same-key retries remain idempotent across active-run changes", async () => {
  const h = fixture();
  await h.service.promptAgent(h.agent.id, {
    text: "initial",
    behavior: "reject-if-busy",
    idempotencyKey: "initial-key",
  });
  await h.service.settledAdmissions();
  await h.service.promptAgent(h.agent.id, {
    text: "initial",
    behavior: "reject-if-busy",
    idempotencyKey: "initial-key",
  });
  const first = await h.service.promptAgent(h.agent.id, {
    text: "followup",
    behavior: "follow-up",
    idempotencyKey: "followup-key",
  });
  h.runs.get("run_1")!.run.status = "completed";
  await h.service.wakeAgentFromHarness(h.agent.id, true);
  const again = await h.service.promptAgent(h.agent.id, {
    text: "followup",
    behavior: "follow-up",
    idempotencyKey: "followup-key",
  });
  assert.equal(first?.id, again?.id);
  assert.deepEqual(first?.eligibility, again?.eligibility);
  assert.equal((await h.inputs.list(h.agent.id)).length, 2);
});

test("ordinary follow-ups use next-turn input while standalone commands retain explicit run deferral", async () => {
  const harness = fixture();
  await harness.service.wakeAgentFromHarness(harness.agent.id, true);
  await harness.service.promptAgent(harness.agent.id, {
    text: "follow now",
    behavior: "follow-up",
  });
  await harness.service.promptAgent(harness.agent.id, {
    text: "!printf standalone",
  });
  const pending = await harness.inputs.list(harness.agent.id);
  assert.deepEqual(pending[0]?.eligibility, { kind: "next_turn" });
  assert.deepEqual(pending[1]?.eligibility, {
    kind: "next_run",
    afterRunId: "run_1",
  });
  await harness.service.abortAgent(harness.agent.id);
});
