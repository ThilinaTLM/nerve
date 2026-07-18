import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator server agent tool routes", () => {
  it("keeps todo tool state scoped per agent", async () => {
    const { state } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const firstAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });
      const secondAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      const setResult = await state.registry.requestTool(
        firstAgent.id,
        "todos_set",
        {
          todos: [
            { todo: "Inspect", done: true },
            { todo: "Implement", done: false },
          ],
        },
      );
      assert.equal(setResult.toolCall.status, "completed");

      const firstGet = await state.registry.requestTool(
        firstAgent.id,
        "todos_get",
        {},
      );
      const firstTodos = (
        firstGet.toolCall.result as {
          details?: { todos?: Array<{ todo: string; done: boolean }> };
        }
      ).details?.todos;
      assert.deepEqual(firstTodos, [
        { todo: "Inspect", done: true },
        { todo: "Implement", done: false },
      ]);

      const secondGet = await state.registry.requestTool(
        secondAgent.id,
        "todos_get",
        {},
      );
      const secondTodos = (
        secondGet.toolCall.result as {
          details?: { todos?: Array<{ todo: string; done: boolean }> };
        }
      ).details?.todos;
      assert.deepEqual(secondTodos, []);
    } finally {
      state.index.close();
    }
  });

  it("rehydrates the latest completed todo_set per agent", async () => {
    const storage = await initializeStorage(await tempHome("nerve-todos-"));
    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    let rehydrated: ReturnType<typeof createOrchestratorState> | undefined;
    let originalClosed = false;
    try {
      await state.registry.hydrate();
      const project = await state.registry.createProject({
        dir: storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      await state.registry.requestTool(agent.id, "todos_set", {
        todos: [{ todo: "Old", done: false }],
      });
      await state.registry.requestTool(agent.id, "todos_set", {
        todos: [{ todo: "Newest", done: true }],
      });
      state.index.close();
      originalClosed = true;

      rehydrated = createOrchestratorState(storage, "127.0.0.1", 0);
      await rehydrated.registry.hydrate();
      const result = await rehydrated.registry.requestTool(
        agent.id,
        "todos_get",
        {},
      );
      const todos = (
        result.toolCall.result as {
          details?: { todos?: Array<{ todo: string; done: boolean }> };
        }
      ).details?.todos;
      assert.deepEqual(todos, [{ todo: "Newest", done: true }]);
    } finally {
      if (!originalClosed) state.index.close();
      rehydrated?.index.close();
    }
  });

  it("returns representative project, conversation, agent, and task log responses", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
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

      const projects = await app.request("/api/projects", { headers });
      assert.equal(projects.status, 200);
      assert.equal(
        ((await projects.json()) as { projects: unknown[] }).projects.length,
        1,
      );

      const conversations = await app.request("/api/conversations", {
        headers,
      });
      assert.equal(conversations.status, 200);
      assert.equal(
        ((await conversations.json()) as { conversations: unknown[] })
          .conversations.length,
        1,
      );

      const agents = await app.request("/api/agents", { headers });
      assert.equal(agents.status, 200);
      assert.equal(
        ((await agents.json()) as { agents: Array<{ id: string }> }).agents[0]
          ?.id,
        agent.id,
      );

      const taskRecord = await state.registry.startTask({
        cwd: state.storage.paths.home,
        command: `${process.execPath} -e "console.log('route-log')"`,
      });
      await delay(100);
      const logs = await app.request(`/api/tasks/${taskRecord.id}/logs`, {
        headers,
      });
      assert.equal(logs.status, 200);
      const body = (await logs.json()) as {
        task: { id: string };
        events: Array<{ line: string }>;
      };
      assert.equal(body.task.id, taskRecord.id);
      assert.ok(body.events.some((event) => event.line.includes("route-log")));
    } finally {
      state.index.close();
    }
  });
});
