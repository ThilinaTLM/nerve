import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathExists } from "../src/infrastructure/storage/index.js";
import {
  addTaskRecord,
  ageConversation,
  createState,
} from "./helpers/registry-conversation.js";

describe("RuntimeRegistry conversation pruning", () => {
  it("prunes old inactive project conversations and associated data", async () => {
    const state = await createState("nerve-registry-prune-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const oldConversation = await state.registry.createConversation({
        projectId: project.id,
        title: "Old Conversation",
      });
      const oldAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: oldConversation.id,
      });
      const recentConversation = await state.registry.createConversation({
        projectId: project.id,
        title: "Recent Conversation",
      });
      await state.registry.createAgent({
        projectId: project.id,
        conversationId: recentConversation.id,
      });
      ageConversation(state, oldConversation, "2000-01-01T00:00:00.000Z");
      ageConversation(state, recentConversation, new Date().toISOString());
      await state.registry.requestTool(oldAgent.id, "todos_set", {
        todos: [{ todo: "remove me", done: false }],
      });
      const inactiveTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: oldConversation.id,
        agentId: oldAgent.id,
        status: "exited",
      });

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "olderThanDays", olderThanDays: 7 },
      );

      assert.equal(result.strategy, "olderThanDays");
      assert.deepEqual(result.prunedConversationIds, [oldConversation.id]);
      assert.deepEqual(result.prunedTaskIds, [inactiveTask.id]);
      assert.deepEqual(result.skipped, []);
      assert.throws(() => state.registry.getConversation(oldConversation.id));
      assert.equal(
        state.registry.getConversation(recentConversation.id).id,
        recentConversation.id,
      );
      assert.equal(
        await pathExists(
          join(state.storage.paths.home, "conversations", oldConversation.id),
        ),
        false,
      );
      assert.equal(
        await pathExists(
          join(state.storage.paths.home, "tasks", inactiveTask.id),
        ),
        false,
      );
      assert.equal(
        state.registry.tools
          .listToolCalls()
          .some((toolCall) => toolCall.conversationId === oldConversation.id),
        false,
      );
    } finally {
      state.index.close();
    }
  });

  it("skips old conversations with active agents or active tasks", async () => {
    const state = await createState("nerve-registry-prune-skip-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const activeAgentConversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const activeAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: activeAgentConversation.id,
      });
      state.registry.agents.set(activeAgent.id, {
        ...activeAgent,
        status: "running",
      });
      const activeTaskConversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const taskAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: activeTaskConversation.id,
      });
      const activeTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: activeTaskConversation.id,
        agentId: taskAgent.id,
        status: "running",
      });
      ageConversation(
        state,
        activeAgentConversation,
        "2000-01-01T00:00:00.000Z",
      );
      ageConversation(
        state,
        activeTaskConversation,
        "2000-01-01T00:00:00.000Z",
      );

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "olderThanDays", olderThanDays: 7 },
      );

      assert.deepEqual(result.prunedConversationIds, []);
      assert.deepEqual(result.prunedTaskIds, []);
      assert.deepEqual(result.skipped, [
        {
          conversationId: activeAgentConversation.id,
          reason: "active_agent",
        },
        {
          conversationId: activeTaskConversation.id,
          reason: "active_task",
        },
      ]);
      assert.equal(
        state.registry.getConversation(activeAgentConversation.id).id,
        activeAgentConversation.id,
      );
      assert.equal(
        state.registry.getConversation(activeTaskConversation.id).id,
        activeTaskConversation.id,
      );
      assert.equal(
        state.registry.tasks.getTask(activeTask.id).id,
        activeTask.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("batches old conversation pruning across projects", async () => {
    const state = await createState("nerve-registry-prune-all-");
    try {
      const firstDir = join(state.storage.paths.home, "first");
      const secondDir = join(state.storage.paths.home, "second");
      await mkdir(firstDir, { recursive: true });
      await mkdir(secondDir, { recursive: true });
      const firstProject = await state.registry.createProject({
        dir: firstDir,
      });
      const secondProject = await state.registry.createProject({
        dir: secondDir,
      });
      const first = await state.registry.createConversation({
        projectId: firstProject.id,
      });
      const second = await state.registry.createConversation({
        projectId: secondProject.id,
      });
      ageConversation(state, first, "2000-01-01T00:00:00.000Z");
      ageConversation(state, second, "2000-01-01T00:00:00.000Z");

      const result = await state.registry.pruneConversationsAcrossProjects({
        strategy: "olderThanDays",
        olderThanDays: 7,
      });

      assert.deepEqual(
        result.prunedConversationIds.sort(),
        [first.id, second.id].sort(),
      );
      assert.equal(result.skippedCount, 0);
      assert.throws(() => state.registry.getConversation(first.id));
      assert.throws(() => state.registry.getConversation(second.id));
    } finally {
      state.index.close();
    }
  });

  it("keeps the most recent conversations when pruning by count", async () => {
    const state = await createState("nerve-registry-prune-keep-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const oldest = await state.registry.createConversation({
        projectId: project.id,
        title: "Oldest",
      });
      const middle = await state.registry.createConversation({
        projectId: project.id,
        title: "Middle",
      });
      const newest = await state.registry.createConversation({
        projectId: project.id,
        title: "Newest",
      });
      ageConversation(state, oldest, "2020-01-01T00:00:00.000Z");
      ageConversation(state, middle, "2020-06-01T00:00:00.000Z");
      ageConversation(state, newest, "2021-01-01T00:00:00.000Z");

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "keepLatest", keepLatest: 1 },
      );

      assert.equal(result.strategy, "keepLatest");
      assert.deepEqual(
        result.prunedConversationIds.sort(),
        [middle.id, oldest.id].sort(),
      );
      assert.deepEqual(result.skipped, []);
      assert.equal(state.registry.getConversation(newest.id).id, newest.id);
      assert.throws(() => state.registry.getConversation(oldest.id));
      assert.throws(() => state.registry.getConversation(middle.id));
    } finally {
      state.index.close();
    }
  });
});
