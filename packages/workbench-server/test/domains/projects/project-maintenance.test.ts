import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageConversation,
  createState,
} from "../../helpers/conversation-runtime.js";

async function waitForTerminal(
  get: () => ReturnType<
    Awaited<ReturnType<typeof createState>>["runtime"]["maintenance"]["get"]
  >,
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const operation = get();
    if (operation && ["succeeded", "failed"].includes(operation.status)) {
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("project maintenance did not finish");
}

describe("Project cleanup through shared maintenance", () => {
  it("accepts conversation cleanup before background deletion completes", async () => {
    const state = await createState("nerve-project-maintenance-prune-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.runtime.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      await ageConversation(state, conversation, "2000-01-01T00:00:00.000Z");
      await state.runtime.maintenance.hydrate();

      const queued = await state.runtime.maintenance.start({
        kind: "prune_conversations",
        projectId: project.id,
        parameters: { strategy: "olderThanDays", olderThanDays: 7 },
      });

      assert.equal(queued.status, "queued");
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .id,
        conversation.id,
      );
      const terminal = await waitForTerminal(() =>
        state.runtime.maintenance.get(),
      );
      assert.equal(terminal.status, "succeeded", terminal.error);
      assert.equal(terminal.completedItems, 1);
      assert.equal(terminal.removedConversationCount, 1);
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(conversation.id),
      );
    } finally {
      await state.runtime.maintenance.shutdown();
      state.runtime.queryCache.close();
      await state.runtime.storage.canonicalStore.close();
    }
  });

  it("serializes project maintenance and removes project metadata last", async () => {
    const state = await createState("nerve-project-maintenance-delete-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.runtime.storage.paths.home,
      });
      await state.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
      await state.runtime.maintenance.hydrate();

      const queued = await state.runtime.maintenance.start({
        kind: "delete_project",
        projectId: project.id,
      });
      assert.equal(queued.status, "queued");
      await assert.rejects(
        state.runtime.maintenance.start({
          kind: "delete_project",
          projectId: project.id,
        }),
        /already in progress/,
      );
      assert.equal(
        state.services.projectLifecycle.getProject(project.id).id,
        project.id,
      );

      const terminal = await waitForTerminal(() =>
        state.runtime.maintenance.get(),
      );
      assert.equal(terminal.status, "succeeded", terminal.error);
      assert.equal(terminal.removedConversationCount, 1);
      assert.throws(() =>
        state.services.projectLifecycle.getProject(project.id),
      );
    } finally {
      await state.runtime.maintenance.shutdown();
      state.runtime.queryCache.close();
      await state.runtime.storage.canonicalStore.close();
    }
  });
});
