import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathExists } from "../../../src/infrastructure/storage-bootstrap/index.js";
import {
  addTaskRecord,
  ageConversation,
  createState,
} from "../../helpers/conversation-runtime.js";

describe("RuntimeLifecycle conversation pruning", () => {
  it("prunes old inactive project conversations and associated data", async () => {
    const state = await createState("nerve-registry-prune-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const oldConversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Old Conversation",
        });
      const oldAgent = await state.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: oldConversation.id,
      });
      const recentConversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Recent Conversation",
        });
      await state.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: recentConversation.id,
      });
      await ageConversation(state, oldConversation, "2000-01-01T00:00:00.000Z");
      await ageConversation(
        state,
        recentConversation,
        new Date().toISOString(),
      );
      await state.services.tools.requestTool(
        state.services.agentLifecycle.getAgent(oldAgent.id),
        "todos_set",
        {
          todos: [{ todo: "remove me", done: false }],
        },
      );
      const inactiveTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: oldConversation.id,
        agentId: oldAgent.id,
        status: "completed",
      });

      const result =
        await state.services.pruneConversations.pruneProjectConversations(
          project.id,
          { strategy: "olderThanDays", olderThanDays: 7 },
        );

      assert.equal(result.strategy, "olderThanDays");
      assert.deepEqual(result.prunedConversationIds, [oldConversation.id]);
      assert.deepEqual(result.prunedTaskIds, [inactiveTask.id]);
      assert.deepEqual(result.skipped, []);
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(
          oldConversation.id,
        ),
      );
      assert.equal(
        state.services.conversationLifecycle.getConversation(
          recentConversation.id,
        ).id,
        recentConversation.id,
      );
      assert.equal(
        await pathExists(
          join(
            state.storage.paths.logsPath,
            "events",
            "conversations",
            `${oldConversation.id}.jsonl`,
          ),
        ),
        false,
      );
      assert.equal(
        await pathExists(
          join(state.storage.paths.tasksPath, `${inactiveTask.id}.logs.jsonl`),
        ),
        false,
      );
      assert.equal(
        state.services.tools
          .listToolCalls()
          .some((toolCall) => toolCall.conversationId === oldConversation.id),
        false,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("prunes completed conversations and keeps unfinished conversations", async () => {
    const state = await createState("nerve-registry-prune-completed-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const completed =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Completed Conversation",
        });
      const unfinished =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Unfinished Conversation",
        });
      await state.services.conversationLifecycle.updateConversationState(
        completed.id,
        {
          completed: true,
        },
      );

      const result =
        await state.services.pruneConversations.pruneProjectConversations(
          project.id,
          { strategy: "completed" },
        );

      assert.equal(result.strategy, "completed");
      assert.deepEqual(result.prunedConversationIds, [completed.id]);
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(completed.id),
      );
      assert.equal(
        state.services.conversationLifecycle.getConversation(unfinished.id).id,
        unfinished.id,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("skips old conversations with active agents or active tasks", async () => {
    const state = await createState("nerve-registry-prune-skip-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const activeAgentConversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const activeAgent = await state.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: activeAgentConversation.id,
      });
      await state.services.agentLifecycle.updateAgent({
        ...activeAgent,
        status: "running",
      });
      const activeTaskConversation =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
        });
      const taskAgent = await state.services.agentLifecycle.createAgent({
        projectId: project.id,
        conversationId: activeTaskConversation.id,
      });
      const activeTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: activeTaskConversation.id,
        agentId: taskAgent.id,
        status: "running",
      });
      await ageConversation(
        state,
        activeAgentConversation,
        "2000-01-01T00:00:00.000Z",
      );
      await ageConversation(
        state,
        activeTaskConversation,
        "2000-01-01T00:00:00.000Z",
      );

      const result =
        await state.services.pruneConversations.pruneProjectConversations(
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
        state.services.conversationLifecycle.getConversation(
          activeAgentConversation.id,
        ).id,
        activeAgentConversation.id,
      );
      assert.equal(
        state.services.conversationLifecycle.getConversation(
          activeTaskConversation.id,
        ).id,
        activeTaskConversation.id,
      );
      assert.equal(
        state.services.tasks.getTask(activeTask.id).id,
        activeTask.id,
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("batches old conversation pruning across projects", async () => {
    const state = await createState("nerve-registry-prune-all-");
    try {
      const firstDir = join(state.storage.paths.home, "first");
      const secondDir = join(state.storage.paths.home, "second");
      await mkdir(firstDir, { recursive: true });
      await mkdir(secondDir, { recursive: true });
      const firstProject = await state.services.projectLifecycle.createProject({
        dir: firstDir,
      });
      const secondProject = await state.services.projectLifecycle.createProject(
        {
          dir: secondDir,
        },
      );
      const first =
        await state.services.conversationLifecycle.createConversation({
          projectId: firstProject.id,
        });
      const second =
        await state.services.conversationLifecycle.createConversation({
          projectId: secondProject.id,
        });
      await ageConversation(state, first, "2000-01-01T00:00:00.000Z");
      await ageConversation(state, second, "2000-01-01T00:00:00.000Z");

      const results =
        await state.services.pruneConversations.pruneAcrossProjects(
          state.services.projectLifecycle.listProjects(),
          { strategy: "olderThanDays", olderThanDays: 7 },
        );
      const result = {
        prunedConversationIds: results.flatMap(
          (item) => item.prunedConversationIds,
        ),
        skippedCount: results.reduce(
          (count, item) => count + item.skipped.length,
          0,
        ),
      };

      assert.deepEqual(
        result.prunedConversationIds.sort(),
        [first.id, second.id].sort(),
      );
      assert.equal(result.skippedCount, 0);
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(first.id),
      );
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(second.id),
      );
    } finally {
      state.queryCache.close();
    }
  });

  it("keeps the most recent conversations when pruning by count", async () => {
    const state = await createState("nerve-registry-prune-keep-");
    try {
      const project = await state.services.projectLifecycle.createProject({
        dir: state.storage.paths.home,
      });
      const oldest =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Oldest",
        });
      const middle =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Middle",
        });
      const newest =
        await state.services.conversationLifecycle.createConversation({
          projectId: project.id,
          title: "Newest",
        });
      await ageConversation(state, oldest, "2020-01-01T00:00:00.000Z");
      await ageConversation(state, middle, "2020-06-01T00:00:00.000Z");
      await ageConversation(state, newest, "2021-01-01T00:00:00.000Z");

      const result =
        await state.services.pruneConversations.pruneProjectConversations(
          project.id,
          { strategy: "keepLatest", keepLatest: 1 },
        );

      assert.equal(result.strategy, "keepLatest");
      assert.deepEqual(
        result.prunedConversationIds.sort(),
        [middle.id, oldest.id].sort(),
      );
      assert.deepEqual(result.skipped, []);
      assert.equal(
        state.services.conversationLifecycle.getConversation(newest.id).id,
        newest.id,
      );
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(oldest.id),
      );
      assert.throws(() =>
        state.services.conversationLifecycle.getConversation(middle.id),
      );
    } finally {
      state.queryCache.close();
    }
  });
});
