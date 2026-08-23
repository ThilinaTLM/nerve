import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";
import {
  appendRegistryEntry,
  createdAt,
  createState,
  firstEntryId,
  oldConversationId,
  tempHome,
} from "./helpers/registry-conversation.js";

describe("RuntimeRegistry conversation lifecycle", () => {
  it("expands legacy auto-truncated conversation titles on hydrate", async () => {
    const storage = await initializeStorage(
      await tempHome("nerve-registry-title-repair-"),
    );
    const conversationDir = join(
      storage.paths.home,
      "conversations",
      oldConversationId,
    );
    await mkdir(conversationDir, { recursive: true });
    const text =
      "Build a focused onboarding screen that explains projects, conversations, agents, and local tool permissions without overwhelming first-time users.";
    const conversation: ConversationRecord = {
      id: oldConversationId,
      projectId: "proj_01HN0000000000000000000000",
      title: "Build a focused onboarding screen that explains projects…",
      mode: "coding",
      permissionLevel: "autonomous",
      activeEntryId: firstEntryId,
      createdAt,
      updatedAt: createdAt,
    };
    const entry: ConversationEntry = {
      id: firstEntryId,
      conversationId: oldConversationId,
      role: "user",
      kind: "message",
      text,
      createdAt,
    };
    await writeFile(
      join(conversationDir, "conversation.json"),
      `${JSON.stringify(conversation)}\n`,
    );
    await writeFile(
      join(conversationDir, "entries.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );

    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    await state.registry.hydrate();

    const repaired = state.registry.getConversation(oldConversationId);
    assert.equal(
      repaired.title,
      "Build a focused onboarding screen that explains projects, conversations",
    );
    assert.equal(repaired.updatedAt, createdAt);
    assert.equal(repaired.lastUserMessageAt, createdAt);

    const persisted = JSON.parse(
      await readFile(join(conversationDir, "conversation.json"), "utf8"),
    ) as ConversationRecord;
    assert.equal(
      persisted.title,
      "Build a focused onboarding screen that explains projects, conversations",
    );
    assert.equal(persisted.updatedAt, createdAt);
    assert.equal(persisted.lastUserMessageAt, createdAt);
  });

  it("tracks last user message time separately from conversation updates", async () => {
    const state = await createState("nerve-registry-last-user-message-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "First prompt",
        createdAt: "2026-01-01T00:01:00.000Z",
      });
      assert.equal(
        state.registry.getConversation(conversation.id).lastUserMessageAt,
        "2026-01-01T00:01:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "assistant",
        text: "Assistant response",
        createdAt: "2026-01-01T00:02:00.000Z",
      });
      assert.equal(
        state.registry.getConversation(conversation.id).lastUserMessageAt,
        "2026-01-01T00:01:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Second prompt",
        createdAt: "2026-01-01T00:03:00.000Z",
      });
      assert.equal(
        state.registry.getConversation(conversation.id).lastUserMessageAt,
        "2026-01-01T00:03:00.000Z",
      );

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Imported older prompt",
        createdAt: "2026-01-01T00:00:30.000Z",
      });
      assert.equal(
        state.registry.getConversation(conversation.id).lastUserMessageAt,
        "2026-01-01T00:03:00.000Z",
      );
    } finally {
      state.index.close();
    }
  });

  it("persists conversation state and reopens on the next user entry", async () => {
    const state = await createState("nerve-registry-conversation-state-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const activityAt = conversation.updatedAt;

      const pinned = await state.registry.updateConversationState(
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
      assert.ok(state.registry.getConversation(conversation.id).completedAt);

      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Reopen this",
        createdAt: "2026-01-01T00:02:00.000Z",
      });
      const reopened = state.registry.getConversation(conversation.id);
      assert.equal(reopened.completedAt, undefined);
      assert.equal(reopened.pinned, true);
      assert.equal(reopened.updatedAt, "2026-01-01T00:02:00.000Z");

      const explicitlyReopened = await state.registry.updateConversationState(
        conversation.id,
        { completed: false, pinned: false },
      );
      assert.equal(explicitlyReopened.completedAt, undefined);
      assert.equal(explicitlyReopened.pinned, false);
      assert.equal(explicitlyReopened.updatedAt, reopened.updatedAt);

      const persisted = JSON.parse(
        await readFile(
          join(
            state.storage.paths.home,
            "conversations",
            conversation.id,
            "conversation.json",
          ),
          "utf8",
        ),
      ) as ConversationRecord;
      assert.equal(persisted.pinned, false);
      assert.equal(persisted.completedAt, undefined);
      assert.ok(persisted.runtimeStatusClearedAt);
    } finally {
      state.index.close();
    }
  });

  it("creates projects, conversations, and agents through public APIs", async () => {
    const state = await createState();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      assert.equal(state.registry.getProject(project.id).id, project.id);
      assert.equal(
        state.registry.getConversation(conversation.id).activeAgentId,
        agent.id,
      );
      assert.equal(
        state.registry.getAgent(agent.id).conversationId,
        conversation.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("publishes compaction lifecycle events with metadata", async () => {
    const state = await createState("nerve-registry-compaction-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
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

      const result = await state.registry.compactConversation(conversation.id);
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
      state.index.close();
    }
  });
});
