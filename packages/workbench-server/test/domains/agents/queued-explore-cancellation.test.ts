import assert from "node:assert/strict";
import { it } from "node:test";
import { ApplicationError } from "../../../src/core/application-error.js";
import { SubagentRunner } from "../../../src/domains/agents/execution/subagent-runner.js";
import { WorkbenchSubagentExecutions } from "../../../src/domains/agents/execution/workbench-subagent-executions.js";
import { fixture } from "../runs/agent-controls.fixture.js";

it("cancels Explore's durable input while capacity stays occupied, without orphan admission or cancelling another assignment", async () => {
  let occupied = true;
  let reserveAttempts = 0;
  const h = fixture({
    admissionPolicy: {
      reserve: async () => {
        reserveAttempts++;
        if (occupied)
          throw new ApplicationError(409, "SUBAGENT_CAPACITY", "Occupied");
      },
      committed: async () => undefined,
      released: async () => undefined,
    },
  });
  const controller = new AbortController();
  const parent = {
    ...h.agent,
    id: "agent_parent",
    rootAgentId: "agent_parent",
    projectDir: "/tmp",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp"] },
    thinkingLevel: "off",
  } as never;
  const runner = new SubagentRunner({
    storage: { paths: { home: "/tmp" } },
    events: { publish: async () => undefined },
    logger: { warn: async () => undefined },
    createAgent: async () => h.agent,
    executions: new WorkbenchSubagentExecutions(),
    runtime: {
      submitRun: (agentId, text, origin, options) =>
        h.service.submitAgentRun(agentId, text, origin, options),
      waitForRun: async () => assert.fail("No run may be admitted"),
      cancelRun: async () => assert.fail("No run identity exists yet"),
    },
  } as ConstructorParameters<typeof SubagentRunner>[0]);
  try {
    const unrelated = await h.service.enqueueAgentInput(h.agent.id, {
      text: "unrelated next turn",
      role: "user",
      origin: { kind: "user", userId: "user" },
      idempotencyKey: "unrelated",
      eligibility: { kind: "next_turn" },
      activation: "queue_only",
    });
    const result = runner.runSubagent({
      kind: "explore",
      parent,
      projectId: h.agent.projectId,
      projectDir: "/tmp",
      mode: "coding",
      permissionLevel: "read_only",
      prompt: "cancel only this Explore assignment",
      systemPrompt: "Research",
      historyMode: "fresh",
      signal: controller.signal,
    });
    const rejected = assert.rejects(result, { name: "AbortError" });
    while (!reserveAttempts)
      await new Promise((resolve) => setImmediate(resolve));
    const assignment = (await h.inputs.list(h.agent.id)).find(
      (input) => input.origin.kind === "parent",
    )!;
    assert.ok(assignment);
    controller.abort();
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        rejected,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Pending Explore did not cancel")),
            1_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    assert.equal(
      occupied,
      true,
      "cancellation must not require capacity release",
    );
    assert.equal(
      (await h.inputs.get(h.agent.id, assignment.id))?.state,
      "cancelled",
    );
    assert.deepEqual(await h.inputs.list(h.agent.id), [unrelated]);
    assert.deepEqual(h.starts, []);
    assert.equal(await h.inputs.isPaused(h.agent.id), false);
    occupied = false;
    const later = await h.service.submitAgentRun(
      h.agent.id,
      "later assignment",
    );
    assert.equal(h.starts.length, 1);
    assert.notEqual(h.runs.get(later.runId)?.run.initialInputId, assignment.id);
    assert.equal(
      (await h.inputs.get(h.agent.id, unrelated.id))?.state,
      "pending",
    );
  } finally {
    h.service.stopAdmissions();
    await h.service.settledInputWork();
  }
});

it("submission abort cancels its delivery run without pausing a newer run or discarding unrelated input", async () => {
  const h = fixture();
  const controller = new AbortController();
  try {
    await h.service.wakeAgentFromHarness(h.agent.id, true);
    const submission = h.service.submitAgentRun(
      h.agent.id,
      "original Explore input",
      { agentId: "agent_parent", runId: "run_parent" },
      { signal: controller.signal },
    );
    const rejected = assert.rejects(submission, /parent cancelled/);
    const unrelated = await h.service.enqueueAgentInput(h.agent.id, {
      text: "next assignment input",
      role: "user",
      origin: { kind: "user", userId: "user" },
      idempotencyKey: "later-input",
      eligibility: { kind: "next_turn" },
      activation: "queue_only",
    });
    let input;
    while (
      !(input = (await h.inputs.list(h.agent.id)).find(
        (item) => item.origin.kind === "parent",
      ))
    )
      await new Promise((resolve) => setImmediate(resolve));
    await h.inputs.prepare(
      {
        agentId: h.agent.id,
        conversationId: h.agent.conversationId,
        runId: "run_1",
        attemptId: "exec_1",
        turnId: "turn_1",
      },
      async () => {
        const original = h.runs.get("run_1")!;
        original.run.status = "completed";
        h.runs.set("run_later", {
          run: {
            ...original.run,
            runId: "run_later",
            executionId: "exec_later",
            status: "running",
          },
        });
        controller.abort(new Error("parent cancelled"));
      },
      async () => false,
      32,
      undefined,
      input.id,
    );
    await rejected;
    assert.equal(h.runs.get("run_later")!.run.status, "running");
    assert.equal(h.agent.activationState, "enabled");
    assert.equal(await h.inputs.isPaused(h.agent.id), false);
    assert.deepEqual(await h.inputs.list(h.agent.id), [unrelated]);
    assert.equal(
      (await h.inputs.get(h.agent.id, input.id))?.delivery?.runId,
      "run_1",
    );
  } finally {
    h.service.stopAdmissions();
    await h.service.settledInputWork();
  }
});
