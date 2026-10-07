import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

it("explicit user child resume executes through common runtime while parent/sibling remain paused and correlated completion stays queued", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-admin-resume-"));
  const provider = "nerve-admin-resume";
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [{ type: "assistantText", text: "Independent child completed." }],
  });
  const storage = await initializeStorage(home);
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const parent = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      permissionLevel: "autonomous",
      model: { provider, modelId: "scripted-fast" },
    });
    const createChild = () =>
      runtime.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        parentAgentId: parent.id,
        orchestrationPolicy: {
          preset: "developer",
          parentCancellation: "independent",
          completionReporting: "parent",
        },
      });
    const child = await createChild(),
      sibling = await createChild();
    await runtime.services.workbenchRun.abortAgent(parent.id);
    const input = await runtime.services.workbenchRun.promptAgent(child.id, {
      text: "Accepted while team paused.",
      idempotencyKey: "independent-child",
    });
    assert.ok(input);
    await runtime.services.workbenchRun.resumeAgent(child.id, undefined, {
      authority: "user_administration",
    });
    const deadline = Date.now() + 3_000;
    let snapshot = await runtime.services.subagentTranscripts.snapshot(
      child.id,
    );
    while (Date.now() < deadline && !snapshot.latestCompletion) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      snapshot = await runtime.services.subagentTranscripts.snapshot(child.id);
    }
    assert.ok(
      snapshot.latestCompletion,
      "persisted explicit administrative proof must allow the child, not reopen its team",
    );
    assert.equal(
      snapshot.latestCompletion.response?.text,
      "Independent child completed.",
    );
    assert.equal(
      runtime.services.agentLifecycle.getAgent(parent.id).activationState,
      "paused",
    );
    assert.equal(
      runtime.services.agentLifecycle.getAgent(sibling.id).activationState,
      "paused",
    );
    await runtime.services.asyncObligations.recover();
    const parentQueue = await runtime.services.workbenchRun.listQueuedPrompts(
      parent.id,
    );
    assert.ok(
      parentQueue.some(
        (item) => "origin" in item && item.origin.kind === "system",
      ),
    );
    assert.equal(
      (await runtime.services.subagentTranscripts.snapshot(parent.id))
        .latestCompletion,
      null,
    );
    assert.equal(
      (await runtime.services.subagentTranscripts.snapshot(sibling.id))
        .latestCompletion,
      null,
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    registration.unregister();
    await rm(home, { recursive: true, force: true });
  }
});
