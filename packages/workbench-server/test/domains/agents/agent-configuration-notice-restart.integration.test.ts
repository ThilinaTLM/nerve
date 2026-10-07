import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

it("initial configuration notice registration fault preserves accepted revisions and copied-home startup reconstructs only exact user receipt once", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-receipt-source-"));
  const copied = await mkdtemp(join(tmpdir(), "nerve-config-receipt-copy-"));
  let runtime: ReturnType<typeof createRuntimeFixture> | undefined;
  try {
    const storage = await initializeStorage(home);
    runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
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
    });
    const child = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      parentAgentId: parent.id,
    });
    const interventions = runtime.services.agentInterventions;
    runtime.services.asyncObligations.register = async () => {
      throw new Error("Injected initial registration fault");
    };
    const userAccepted = await runtime.services.agentLifecycle.configureAgent(
      child.id,
      { instructions: "user accepted original" },
      {
        actor: { kind: "user", userId: "authorized-user" },
        onConfigurationAccepted: (receipt) =>
          interventions.configurationAccepted(receipt),
      },
    );
    assert.equal(userAccepted.configurationRevision, 2);
    assert.equal(userAccepted.instructions, "user accepted original");
    const id = `user_intervention:configuration:${child.id}:2:0`;
    assert.equal(
      await storage.canonicalStore.readAgentObligation(id),
      undefined,
    );
    await runtime.services.agentLifecycle.configureAgent(
      child.id,
      { instructions: "parent later" },
      {
        parentAgentId: parent.id,
        actor: { kind: "parent", agentId: parent.id },
      },
    );
    await runtime.services.agentLifecycle.configureAgent(
      child.id,
      { instructions: "self later" },
      { actor: { kind: "self", agentId: child.id } },
    );
    const receipts =
      await runtime.services.agentLifecycle.listConfigurationAcceptances(
        child.id,
      );
    assert.deepEqual(
      receipts.map((receipt) => [
        receipt.configurationRevision,
        receipt.actor.kind,
      ]),
      [
        [2, "user"],
        [3, "parent"],
        [4, "self"],
      ],
    );
    await shutdownServerRuntime(runtime.runtime);
    runtime = undefined;
    await cp(home, copied, { recursive: true });
    const restoredStorage = await initializeStorage(copied);
    runtime = createRuntimeFixture(restoredStorage, "127.0.0.1", 0);
    const noticeErrors: string[] = [];
    runtime.services.agentInterventions.deferred = (error) => {
      noticeErrors.push(String(error));
    };
    await runtime.lifecycle.hydrate();
    await runtime.services.agentInterventions.recoverConfigurationAcceptances();
    await runtime.services.agentInterventions.recoverConfigurationAcceptances();
    const restored = runtime.services.agentLifecycle.getAgent(child.id);
    assert.equal(restored.configurationRevision, 4);
    assert.equal(restored.instructions, "self later");
    const obligation =
      await restoredStorage.canonicalStore.readAgentObligation(id);
    assert.ok(
      obligation,
      JSON.stringify({
        noticeErrors,
        receipts:
          await runtime.services.agentLifecycle.listConfigurationAcceptances(
            child.id,
          ),
      }),
    );
    assert.equal(obligation.sourceId, `configuration:${child.id}:2`);
    assert.equal(obligation.ownerAgentId, parent.id);
    for (const revision of [3, 4])
      assert.equal(
        await restoredStorage.canonicalStore.readAgentObligation(
          `user_intervention:configuration:${child.id}:${revision}:0`,
        ),
        undefined,
      );
    const queue = await runtime.services.workbenchRun.listQueuedPrompts(
      parent.id,
    );
    const notices = queue.filter(
      (item) =>
        "text" in item && item.text.includes(`configuration:${child.id}:2`),
    );
    assert.equal(notices.length, 1);
  } finally {
    if (runtime) await shutdownServerRuntime(runtime.runtime);
    await rm(home, { recursive: true, force: true });
    await rm(copied, { recursive: true, force: true });
  }
});
