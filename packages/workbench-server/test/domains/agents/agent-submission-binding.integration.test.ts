import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { WorkbenchAgentMechanics } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

async function fixture(provider: string) {
  const home = await mkdtemp(join(tmpdir(), "nerve-submission-binding-"));
  let storage = await initializeStorage(home);
  let runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  await runtime.lifecycle.hydrate();
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
    model: { provider, modelId: "scripted-fast" },
  });
  return {
    agent,
    conversation,
    get runtime() {
      return runtime;
    },
    get storage() {
      return storage;
    },
    async reopen() {
      await shutdownServerRuntime(runtime.runtime);
      storage = await initializeStorage(home);
      runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
      await runtime.lifecycle.hydrate();
    },
    async close() {
      await shutdownServerRuntime(runtime.runtime);
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    },
  };
}

async function agentRuns(h: Awaited<ReturnType<typeof fixture>>) {
  const journal = await h.runtime.services.conversationJournal.load(
    h.conversation.id,
  );
  return [...journal.runProjections.values()].filter(
    (state) => state.run.agentId === h.agent.id,
  );
}

test("named submission keeps original attempt proof through an actual same-run automatic retry", async () => {
  const provider = "nerve-submission-binding-retry";
  const registration = registerAgentScriptedProvider({ provider, steps: [] });
  const h = await fixture(provider);
  const payloads: string[] = [];
  registration.setResponses([
    (context) => {
      payloads.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "RETRYABLE: provider returned error 503: overloaded",
      });
    },
    (context) => {
      payloads.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("REPORT_AFTER_SAME_RUN_RETRY");
    },
  ]);
  try {
    const submitted = await h.runtime.services.workbenchRun.submitAgentRun(
      h.agent.id,
      "EXACT_RETRY_ASSIGNMENT",
      undefined,
      { idempotencyKey: "retry-original" },
    );
    const completion = await h.runtime.services.workbenchRun.waitForAgentRun(
      submitted,
      AbortSignal.timeout(20_000),
    );
    const state = await h.runtime.services.workbenchRun.loadRunState(
      submitted.runId,
    );
    assert.ok(state);
    assert.equal(state.run.status, "completed");
    assert.equal(state.run.attempt, 2);
    assert.equal(completion.runId, submitted.runId);
    assert.equal(completion.submittedAttemptId, submitted.attemptId);
    assert.equal(state.transitions[0]?.run.executionId, submitted.attemptId);
    assert.equal(completion.attemptId, state.run.executionId);
    assert.notEqual(completion.attemptId, submitted.attemptId);
    assert.equal(completion.response?.runId, submitted.runId);
    assert.equal(completion.response?.text, "REPORT_AFTER_SAME_RUN_RETRY");
    assert.equal((await agentRuns(h)).length, 1);
    assert.equal(payloads.length, 2);
    for (const payload of payloads)
      assert.match(payload, /EXACT_RETRY_ASSIGNMENT/);
  } finally {
    registration.unregister();
    await h.close();
  }
});

test("predispatch preparation failure retains the accepted prompt with zero provider requests and no replay", async (t) => {
  const provider = "nerve-submission-binding-preparation";
  const registration = registerAgentScriptedProvider({ provider, steps: [] });
  const h = await fixture(provider);
  let requests = 0;
  registration.setResponses([
    () => {
      requests++;
      return fauxAssistantMessage("MUST_NOT_DISPATCH");
    },
  ]);
  // Inject failure at the real turn's model/resource preparation boundary,
  // before durable prompt insertion or the provider dispatch claim.
  const preparation = t.mock.method(
    WorkbenchAgentMechanics.prototype,
    "customModels",
    async () => {
      throw new Error("fixture model resource preparation failed");
    },
  );
  try {
    const submitted = await h.runtime.services.workbenchRun.submitAgentRun(
      h.agent.id,
      "RETAINED_ORIGINAL_PROMPT",
      undefined,
      { idempotencyKey: "preparation-original" },
    );
    const completion = await h.runtime.services.workbenchRun.waitForAgentRun(
      submitted,
      AbortSignal.timeout(15_000),
    );
    assert.equal(completion.outcome, "failed");
    assert.ok(preparation.mock.callCount() > 0);
    assert.equal(requests, 0);
    const state = await h.runtime.services.workbenchRun.loadRunState(
      submitted.runId,
    );
    assert.ok(state?.run.initialInputId);
    const queue = await new AgentInputRepository(h.storage).load(h.agent.id);
    const input = queue?.inputs.find(
      (item) => item.id === state.run.initialInputId,
    );
    assert.ok(input);
    assert.equal(input.state, "pending");
    assert.equal(input.text, "RETAINED_ORIGINAL_PROMPT");
    assert.equal(input.idempotencyKey, "preparation-original");
    assert.equal(input.delivery, undefined);
    preparation.mock.restore();
    await h.runtime.services.workbenchRun.settledInputWork();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      requests,
      0,
      "restoring preparation does not authorize replay",
    );
    assert.equal((await agentRuns(h)).length, 1);
    assert.equal(
      (await new AgentInputRepository(h.storage).load(h.agent.id))?.inputs.find(
        (item) => item.id === input.id,
      )?.state,
      "pending",
    );
  } finally {
    preparation.mock.restore();
    registration.unregister();
    await h.close();
  }
});

test("same-key submission after reopening resolves the original terminal run and accepted input without admission", async () => {
  const provider = "nerve-submission-binding-reopen";
  const registration = registerAgentScriptedProvider({ provider, steps: [] });
  const h = await fixture(provider);
  let requests = 0;
  registration.setResponses([
    (context) => {
      requests++;
      assert.match(
        JSON.stringify(context.messages),
        /ORIGINAL_RESTART_ASSIGNMENT/,
      );
      return fauxAssistantMessage("ORIGINAL_TERMINAL_REPORT");
    },
  ]);
  try {
    const submitted = await h.runtime.services.workbenchRun.submitAgentRun(
      h.agent.id,
      "ORIGINAL_RESTART_ASSIGNMENT",
      undefined,
      { idempotencyKey: "reopen-original" },
    );
    const completed = await h.runtime.services.workbenchRun.waitForAgentRun(
      submitted,
      AbortSignal.timeout(15_000),
    );
    assert.equal(completed.outcome, "completed");
    const original = await h.runtime.services.workbenchRun.loadRunState(
      submitted.runId,
    );
    assert.ok(original?.run.initialInputId);
    const queue = await new AgentInputRepository(h.storage).load(h.agent.id);
    const accepted = queue?.inputs.find(
      (input) => input.id === original.run.initialInputId,
    );
    assert.ok(accepted);
    assert.equal(accepted.text, "ORIGINAL_RESTART_ASSIGNMENT");
    assert.equal(accepted.state, "delivered");
    await h.reopen();
    const resumed = await h.runtime.services.workbenchRun.submitAgentRun(
      h.agent.id,
      "ORIGINAL_RESTART_ASSIGNMENT",
      undefined,
      {
        idempotencyKey: "reopen-original",
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.deepEqual(resumed, submitted);
    const completion = await h.runtime.services.workbenchRun.waitForAgentRun(
      resumed,
      AbortSignal.timeout(15_000),
    );
    assert.equal(completion.response?.text, "ORIGINAL_TERMINAL_REPORT");
    assert.equal(completion.submittedAttemptId, submitted.attemptId);
    const after = await h.runtime.services.workbenchRun.loadRunState(
      resumed.runId,
    );
    assert.equal(after?.run.initialInputId, accepted.id);
    assert.deepEqual(
      (await new AgentInputRepository(h.storage).load(h.agent.id))?.inputs.find(
        (input) => input.id === accepted.id,
      ),
      accepted,
    );
    assert.equal((await agentRuns(h)).length, 1);
    assert.equal(requests, 1);
  } finally {
    registration.unregister();
    await h.close();
  }
});
