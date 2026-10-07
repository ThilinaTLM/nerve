import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

it("normal additional-root history reads actual persisted run-transition effective configuration, not current accepted settings or an unwritten document", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-history-runtime-"));
  const provider = "nerve-history-persisted";
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [{ type: "assistantText", text: "Persisted original answer." }],
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
    await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
    });
    const root = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
      permissionLevel: "autonomous",
    });
    assert.equal(root.contextOwnerAgentId, root.id);
    const accepted = await runtime.services.workbenchRun.promptAgent(root.id, {
      text: "Use original actual configuration.",
    });
    assert.ok(accepted);
    const deadline = Date.now() + 10_000;
    let snapshot = await runtime.services.subagentTranscripts.snapshot(root.id);
    while (Date.now() < deadline && !snapshot.latestCompletion) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      snapshot = await runtime.services.subagentTranscripts.snapshot(root.id);
    }
    assert.ok(snapshot.latestCompletion, "real ordinary run must complete");
    assert.equal(
      snapshot.effectiveConfiguration?.configurationProvenance,
      "resolved",
    );
    assert.equal(
      snapshot.effectiveConfiguration?.configuration.model?.provider,
      provider,
    );
    assert.equal(
      snapshot.latestCompletion.response?.text,
      "Persisted original answer.",
    );
    assert.ok(
      snapshot.activeEntryIds?.includes(
        snapshot.latestCompletion.response!.entryId,
      ),
    );
    await runtime.services.agentLifecycle.configureAgent(root.id, {
      instructions: "accepted AFTER original invocation",
      model: { provider, modelId: "different-unused" },
    });
    const after = await runtime.services.subagentTranscripts.snapshot(root.id);
    assert.equal(
      after.effectiveConfiguration?.configuration.model?.modelId,
      "scripted-fast",
    );
    assert.ok(
      !after.effectiveConfiguration?.configuration.instructions?.includes(
        "AFTER",
      ),
    );
    assert.equal(
      (
        await storage.canonicalStore.listDocuments(
          "agent_effective_turn",
          root.id,
        )
      ).length,
      0,
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    registration.unregister();
    await rm(home, { recursive: true, force: true });
  }
});
