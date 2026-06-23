import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { initializeStorage } from "../src/infrastructure/storage/index.js";
import { createOrchestratorState } from "../src/server.js";
import { createAuthenticatedApp, tempHome } from "./helpers/server-routes.js";

describe("orchestrator server agent tool routes", () => {
  it("lists and answers pending user questions", async () => {
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

      const toolPromise = state.registry.requestTool(agent.id, "ask_user", {
        question: "What should I optimize for?",
        context: "The implementation has two reasonable paths.",
        recommendation: "Prefer the simpler path.",
      });

      let questionId = "";
      for (let i = 0; i < 20; i += 1) {
        const response = await app.request(
          "/api/user-questions?status=pending",
          { headers },
        );
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          questions: Array<{ id: string; question: string }>;
        };
        questionId = body.questions[0]?.id ?? "";
        if (questionId) break;
        await delay(20);
      }
      assert.ok(questionId.startsWith("question_"));

      const answer = await app.request(
        `/api/user-questions/${questionId}/answer`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ answer: "Optimize for maintainability." }),
        },
      );
      assert.equal(answer.status, 200);
      assert.equal(
        ((await answer.json()) as { question: { status: string } }).question
          .status,
        "answered",
      );

      const result = await toolPromise;
      assert.equal(result.toolCall.status, "completed");
      assert.deepEqual(
        (result.toolCall.result as { response?: string; dismissed?: boolean })
          .response,
        "Optimize for maintainability.",
      );
      assert.equal(
        (result.toolCall.result as { response?: string; dismissed?: boolean })
          .dismissed,
        false,
      );
    } finally {
      state.index.close();
    }
  });

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
