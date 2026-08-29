import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import {
  appendRegistryEntry,
  createState,
} from "../../helpers/conversation-runtime.js";

describe("RuntimeLifecycle conversation lifecycle", () => {
  it("returns the first transcript entry when an id is appended again", async () => {
    const state = await createState("nerve-registry-idempotent-entry-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const entryId = "entry_idempotent_task_event";
      const original = await appendRegistryEntry(state, {
        id: entryId,
        conversationId: conversation.id,
        role: "system",
        text: "Task completed",
        createdAt: "2026-01-01T00:01:00.000Z",
      });
      const repeated = await appendRegistryEntry(state, {
        id: entryId,
        conversationId: conversation.id,
        parentEntryId: "entry_different_parent",
        role: "system",
        text: "Regenerated task completion",
        createdAt: "2026-01-01T00:02:00.000Z",
      });

      assert.deepEqual(repeated, original);
      assert.deepEqual(
        state.services.conversationLifecycle.getConversationEntries(
          conversation.id,
        ),
        [original],
      );
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .activeEntryId,
        entryId,
      );
      assert.equal(
        (
          await new ConversationJournalRepository(state.storage).load(
            conversation.id,
          )
        ).entries.length,
        1,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("tracks last user message time separately from conversation updates", async () => {
    const state = await createState("nerve-registry-last-user-message-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "First prompt",
        createdAt: "2026-01-01T00:01:00.000Z",
      });
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .lastUserMessageAt,
        "2026-01-01T00:01:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "assistant",
        text: "Assistant response",
        createdAt: "2026-01-01T00:02:00.000Z",
      });
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .lastUserMessageAt,
        "2026-01-01T00:01:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Second prompt",
        createdAt: "2026-01-01T00:03:00.000Z",
      });
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .lastUserMessageAt,
        "2026-01-01T00:03:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Imported older prompt",
        createdAt: "2026-01-01T00:00:30.000Z",
      });
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .lastUserMessageAt,
        "2026-01-01T00:03:00.000Z",
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("persists conversation state and reopens on the next user entry", async () => {
    const state = await createState("nerve-registry-conversation-state-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const activityAt = conversation.updatedAt;

      const pinned =
        await state.services.conversationLifecycle.updateConversationState(
          conversation.id,
          { pinned: true, completed: true, clearRuntimeStatus: true },
        );
      assert.equal(pinned.pinned, true);
      assert.ok(pinned.completedAt);
      assert.ok(pinned.runtimeStatusClearedAt);
      assert.equal(pinned.updatedAt, activityAt);

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "assistant",
        text: "Still complete",
        createdAt: "2026-01-01T00:01:00.000Z",
      });
      assert.ok(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .completedAt,
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Reopen this",
        createdAt: "2026-01-01T00:02:00.000Z",
      });
      const reopened = state.services.conversationLifecycle.getConversation(
        conversation.id,
      );
      assert.equal(reopened.completedAt, undefined);
      assert.equal(reopened.pinned, true);
      assert.equal(reopened.updatedAt, "2026-01-01T00:02:00.000Z");

      const explicitlyReopened =
        await state.services.conversationLifecycle.updateConversationState(
          conversation.id,
          { completed: false, pinned: false },
        );
      assert.equal(explicitlyReopened.completedAt, undefined);
      assert.equal(explicitlyReopened.pinned, false);
      assert.equal(explicitlyReopened.updatedAt, reopened.updatedAt);

      const persisted = (
        await new ConversationJournalRepository(state.storage).load(
          conversation.id,
        )
      ).conversation as ConversationRecord;
      assert.equal(persisted.pinned, false);
      assert.equal(persisted.completedAt, undefined);
      assert.ok(persisted.runtimeStatusClearedAt);
    } finally {
      state.queryCache.close();
    }
  });

  it("creates projects, conversations, and agents through public APIs", async () => {
    const state = await createState();
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const agent = await state.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      assert.equal(
        state.services.projectLifecycle.getProject(project.id).id,
        project.id,
      );
      assert.equal(
        state.services.conversationLifecycle.getConversation(conversation.id)
          .activeAgentId,
        agent.id,
      );
      assert.equal(
        state.services.agentLifecycle.getAgent(agent.id).conversationId,
        conversation.id,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("publishes compaction lifecycle events with metadata", async () => {
    const state = await createState("nerve-registry-compaction-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const conversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const first = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Please inspect this project.",
      });
      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        parentEntryId: first.id,
        role: "assistant",
        text: "I inspected it and found several files.",
      });
      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Now summarize the work.",
      });

      const result = await state.services.compactionService.compactConversation(
        conversation.id,
        {},
        { reason: "manual" },
      );
      const events = (
        await state.events.readStream(`conv/${conversation.id}`, 1, 5_000)
      ).events;
      const started = events.find(
        (event) => event.type === "conversation.compaction.started",
      );
      const compacted = events.find(
        (event) => event.type === "conversation.compacted",
      );

      assert.ok(started);
      assert.equal((started.data as { reason?: string }).reason, "manual");
      assert.ok(compacted);
      assert.equal((compacted.data as { reason?: string }).reason, "manual");
      assert.equal(
        (compacted.data as { entryId?: string }).entryId,
        result.entry.id,
      );
      assert.equal((compacted.data as { entry?: unknown }).entry, undefined);
      assert.equal(result.entry.kind, "compaction");
      assert.equal(
        (result.entry.details as { reason?: string }).reason,
        "manual",
      );
      assert.equal(
        (result.entry.details as { generatedBy?: string }).generatedBy,
        "orchestrator-extractive",
      );
      const compactedDetails = result.entry.details as {
        tokensAfter?: number;
        freedTokens?: number;
      };
      assert.equal(typeof compactedDetails.tokensAfter, "number");
      assert.equal(typeof compactedDetails.freedTokens, "number");
      assert.equal(
        typeof (compacted.data as { tokensAfter?: number }).tokensAfter,
        "number",
      );
      assert.equal(
        typeof (compacted.data as { freedTokens?: number }).freedTokens,
        "number",
      );
    } finally {
      state.queryCache.close();
    }
  });
});
