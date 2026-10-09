import type { AgentRecord } from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import { resolveAgentInputBinding } from "../../../src/domains/runs/application/workbench-agent-input-binding.js";
import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../../src/core/application-error.js";
import { fixture } from "./agent-controls.fixture.js";

async function queuedSubmission(
  h: ReturnType<typeof fixture>,
  key = "binding-key",
) {
  return h.inputs.accept(
    h.agent.id,
    h.agent.conversationId,
    {
      text: "named assignment",
      role: "user",
      origin: { kind: "user", userId: "authorized-user" },
      idempotencyKey: key,
      eligibility: { kind: "next_turn" },
      activation: "wake_if_idle",
    },
    async () => undefined,
  );
}
function seedAdmission(
  h: ReturnType<typeof fixture>,
  inputId: string,
  runId = "run_original",
) {
  const run = {
    runId,
    agentId: h.agent.id,
    conversationId: h.agent.conversationId,
    projectId: h.agent.projectId,
    scopeId: `${h.agent.conversationId}:${h.agent.id}`,
    executionId: "exec_original",
    status: "failed",
    updatedAt: new Date().toISOString(),
    initialInputId: inputId,
  };
  h.runs.set(runId, { run });
  return run;
}

test("three named submissions use bounded correlation without historical enumeration", async () => {
  const harnesses = [fixture(), fixture(), fixture()];
  const identities = await Promise.all(
    harnesses.map((h) => h.service.submitAgentRun(h.agent.id, "assignment")),
  );
  for (const [i, h] of harnesses.entries()) {
    assert.equal(identities[i]?.runId, "run_1");
    assert.equal(h.starts.length, 1);
    await h.service.abortAgent(h.agent.id);
  }
});

test("settled originating admission survives retry and later duplicate input with unrelated delivery attempt", async () => {
  const h = fixture();
  const input = await queuedSubmission(h);
  const original = seedAdmission(h, input.id);
  original.executionId = "exec_retry";
  h.runs.get(original.runId)!.transitions = [
    { run: { ...original, executionId: "exec_original" } },
  ];
  const later = seedAdmission(h, input.id, "run_later");
  later.executionId = "exec_later";
  await h.inputs.prepare(
    {
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      runId: later.runId,
      attemptId: "exec_later",
      turnId: "turn_later",
    },
    async () => undefined,
    async () => false,
  );
  const identity = await h.service.submitAgentRun(
    h.agent.id,
    "named assignment",
    undefined,
    { idempotencyKey: "binding-key" },
  );
  assert.deepEqual(identity, {
    agentId: h.agent.id,
    runId: original.runId,
    attemptId: "exec_original",
  });
  assert.equal(h.starts.length, 0);
  assert.ok(
    h.hydratedRunIds.every((id) => [original.runId, later.runId].includes(id)),
  );
});

test("matching receipt supplies selected run's delivery attempt", async () => {
  const h = fixture();
  const input = await queuedSubmission(h);
  const original = seedAdmission(h, input.id);
  await h.inputs.prepare(
    {
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      runId: original.runId,
      attemptId: "exec_delivery",
      turnId: "turn_delivery",
    },
    async () => undefined,
    async () => false,
  );
  const identity = await h.service.submitAgentRun(
    h.agent.id,
    "named assignment",
    undefined,
    { idempotencyKey: "binding-key" },
  );
  assert.equal(identity.attemptId, "exec_delivery");
  assert.equal(h.starts.length, 0);
});

for (const corruption of [
  "dangling",
  "agent",
  "conversation",
  "scope",
  "runId",
  "transitionOwner",
  "transitionRun",
  "transitionInput",
] as const) {
  test(`submission fails closed for ${corruption} binding`, async () => {
    const h = fixture();
    const input = await queuedSubmission(h);
    const run = seedAdmission(h, input.id);
    if (
      corruption === "transitionOwner" ||
      corruption === "transitionRun" ||
      corruption === "transitionInput"
    ) {
      // Original execution proof must belong to this run, input and owner.
      h.runs.get(run.runId)!.transitions = [
        {
          run: {
            ...run,
            ...(corruption === "transitionOwner"
              ? { agentId: "agent_foreign" }
              : {}),
            ...(corruption === "transitionRun" ? { runId: "run_foreign" } : {}),
            ...(corruption === "transitionInput"
              ? { initialInputId: "input_foreign" }
              : {}),
          },
        },
      ];
    } else {
      await h.inputs.prepare(
        {
          agentId: h.agent.id,
          conversationId: h.agent.conversationId,
          runId: run.runId,
          attemptId: "exec_delivery",
          turnId: "turn_delivery",
        },
        async () => undefined,
        async () => false,
      );
      if (corruption === "dangling") h.runs.delete(run.runId);
      if (corruption === "agent") run.agentId = "agent_foreign";
      if (corruption === "conversation") run.conversationId = "conv_foreign";
      if (corruption === "scope") run.scopeId = "conv_foreign:agent_foreign";
      if (corruption === "runId") run.runId = "run_foreign";
    }
    await assert.rejects(
      h.service.submitAgentRun(h.agent.id, "named assignment", undefined, {
        idempotencyKey: "binding-key",
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "AGENT_INPUT_BINDING_INVALID",
    );
    assert.equal(h.starts.length, 0);
  });
}

test("settlement while waiting for admission fence does not admit duplicate", async () => {
  const h = fixture();
  await queuedSubmission(h);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.beforeStart(async () => {
    entered();
    await gate;
  });
  h.afterStart(async () => {
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
    h.runs.get("run_1")!.run.status = "completed";
  });
  const waking = h.service.wakeAgentFromHarness(h.agent.id);
  await ready;
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "named assignment",
    undefined,
    { idempotencyKey: "binding-key" },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await waking;
  assert.equal((await submitting).runId, "run_1");
  assert.equal(h.starts.length, 1);
});

test("aborted named submission cancels original admission, not a later receipt or assignment", async () => {
  const abort = new AbortController();
  let armed = false;
  const h = fixture({
    inputAccepted: async () => {
      if (armed) abort.abort(new Error("parent cancelled"));
    },
  });
  const input = await queuedSubmission(h);
  const original = seedAdmission(h, input.id);
  const later = seedAdmission(h, input.id, "run_later");
  later.status = "running";
  await h.inputs.prepare(
    {
      agentId: h.agent.id,
      conversationId: h.agent.conversationId,
      runId: later.runId,
      attemptId: "exec_later",
      turnId: "turn_later",
    },
    async () => undefined,
    async () => false,
  );
  armed = true;
  // Acceptance callback fires on retry as well; abort is installed after durable acceptance.
  await assert.rejects(
    h.service.submitAgentRun(h.agent.id, "named assignment", undefined, {
      idempotencyKey: "binding-key",
      signal: abort.signal,
    }),
    /parent cancelled/,
  );
  assert.equal(later.status, "running");
  assert.equal(h.agent.activationState, "enabled");
  assert.equal(original.status, "cancelled");
  later.status = "completed";
});

for (const corruption of ["agent", "dangling"] as const) {
  test(`foreign or dangling later receipt fails closed even with original admission: ${corruption}`, async () => {
    const abort = new AbortController();
    let armed = false;
    const h = fixture({
      inputAccepted: async () => {
        if (armed) abort.abort(new Error("parent cancelled"));
      },
    });
    const input = await queuedSubmission(h);
    const original = seedAdmission(h, input.id);
    const later = seedAdmission(h, input.id, "run_later");
    later.status = "running";
    await h.inputs.prepare(
      {
        agentId: h.agent.id,
        conversationId: h.agent.conversationId,
        runId: later.runId,
        attemptId: "exec_later",
        turnId: "turn_later",
      },
      async () => undefined,
      async () => false,
    );
    if (corruption === "agent") later.agentId = "agent_foreign";
    else h.runs.delete(later.runId);
    await assert.rejects(
      h.service.submitAgentRun(h.agent.id, "named assignment", undefined, {
        idempotencyKey: "binding-key",
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "AGENT_INPUT_BINDING_INVALID",
    );
    armed = true;
    await assert.rejects(
      h.service.submitAgentRun(h.agent.id, "named assignment", undefined, {
        idempotencyKey: "binding-key",
        signal: abort.signal,
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "AGENT_INPUT_BINDING_INVALID",
    );
    assert.equal(original.status, "failed");
    assert.equal(later.status, "running");
    assert.equal(h.starts.length, 0);
    assert.equal(h.agent.activationState, "enabled");
  });
}

test("targeted lookup metadata for another originating input fails before hydration", async () => {
  const h = fixture();
  const input = await queuedSubmission(h);
  const run = seedAdmission(h, "input_foreign");
  await assert.rejects(
    resolveAgentInputBinding(
      {
        findByInitialInputId: async () => run as RunRecord,
        loadFresh: async () =>
          assert.fail("invalid metadata must not hydrate a run"),
      },
      h.agent as AgentRecord,
      input.id,
      input,
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "AGENT_INPUT_BINDING_INVALID",
  );
});

for (const owner of ["agentId", "conversationId"] as const) {
  test(`foreign receipt ${owner} fails closed even for valid selected delivery run`, async () => {
    const h = fixture();
    const input = await queuedSubmission(h);
    const run = seedAdmission(h, input.id);
    await h.inputs.prepare(
      {
        agentId: h.agent.id,
        conversationId: h.agent.conversationId,
        runId: run.runId,
        attemptId: "exec_delivery",
        turnId: "turn_delivery",
      },
      async () => undefined,
      async () => false,
    );
    const receipt = (await h.inputs.get(h.agent.id, input.id))!;
    const foreign = {
      ...receipt,
      [owner]: owner === "agentId" ? "agent_foreign" : "conv_foreign",
    };
    await assert.rejects(
      resolveAgentInputBinding(
        {
          findByInitialInputId: async () => run as RunRecord,
          loadFresh: async () =>
            assert.fail("foreign receipt must fail before hydration"),
        },
        h.agent as AgentRecord,
        input.id,
        foreign,
      ),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "AGENT_INPUT_BINDING_INVALID",
    );
  });
}

test("abort during gated admission binding reread rejects and cancels only originating assignment", async () => {
  const h = fixture();
  const input = await queuedSubmission(h);
  const abort = new AbortController();
  const reason = new Error("parent cancelled during fenced reread");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  h.beforeInitialInputLookup(async () => {
    if (++reads !== 2) return;
    seedAdmission(h, input.id);
    const unrelated = seedAdmission(h, "input_other", "run_other");
    unrelated.status = "running";
    entered();
    await gate;
  });
  const submitting = h.service.submitAgentRun(
    h.agent.id,
    "named assignment",
    undefined,
    { idempotencyKey: "binding-key", signal: abort.signal },
  );
  const rejection = assert.rejects(submitting, (error) => error === reason);
  await ready;
  abort.abort(reason);
  release();
  await rejection;
  assert.deepEqual(h.cancelledRunIds, ["run_original"]);
  assert.equal(h.runs.get("run_original")!.run.status, "cancelled");
  assert.equal(h.runs.get("run_other")!.run.status, "running");
  assert.equal((await h.inputs.get(h.agent.id, input.id))!.state, "cancelled");
  assert.equal(h.agent.activationState, "enabled");
  assert.equal(h.starts.length, 0);
});

test("execution cancellation evidence waits outside the agent admission fence", async () => {
  const abort = new AbortController();
  const reason = new Error("parent cancelled original assignment");
  const h = fixture({
    inputAccepted: async (input) => {
      if (input.idempotencyKey === "binding-key") abort.abort(reason);
    },
  });
  const input = await queuedSubmission(h);
  seedAdmission(h, input.id);
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.beforeCancel(async () => {
    entered();
    await gate;
  });
  const original = assert.rejects(
    h.service.submitAgentRun(h.agent.id, "named assignment", undefined, {
      idempotencyKey: "binding-key",
      signal: abort.signal,
    }),
    (error) => error === reason,
  );
  await ready;
  const later = h.service.submitAgentRun(
    h.agent.id,
    "unrelated next assignment",
    undefined,
    { idempotencyKey: "later-key" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const identity = await Promise.race([
      later,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("execution cancellation held admission fence")),
          1000,
        );
      }),
    ]);
    assert.equal(identity.runId, "run_1");
  } finally {
    clearTimeout(timer);
    release();
    await original;
    await later;
  }
  assert.deepEqual(h.cancelledRunIds, ["run_original"]);
  assert.equal(h.runs.get("run_1")!.run.status, "running");
  await h.service.abortAgent(h.agent.id);
});
