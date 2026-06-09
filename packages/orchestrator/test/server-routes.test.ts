import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApp, createOrchestratorState } from "../src/server.js";
import { initializeStorage } from "../src/storage.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createAuthenticatedApp() {
  const storage = await initializeStorage(
    await tempHome("nerve-server-routes-"),
  );
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.logger.hydrate();
  await state.registry.hydrate();
  const app = createApp(state);
  const headers = { authorization: `Bearer ${storage.localToken}` };
  return { app, state, headers };
}

describe("orchestrator server routes", () => {
  it("accepts and queries application logs", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const writeResponse = await app.request("/api/logs/client", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          logs: [
            {
              level: "error",
              component: "test-client",
              message: "client exploded",
              context: { token: "secret" },
            },
          ],
        }),
      });
      assert.equal(writeResponse.status, 200);

      const readResponse = await app.request("/api/logs?level=error", {
        headers,
      });
      assert.equal(readResponse.status, 200);
      const body = (await readResponse.json()) as {
        logs: Array<{
          source: string;
          component: string;
          context?: Record<string, unknown>;
        }>;
      };
      assert.ok(
        body.logs.some(
          (log) => log.source === "web" && log.component === "test-client",
        ),
      );
    } finally {
      state.index.close();
    }
  });

  it("requires local auth for core API routes", async () => {
    const { app, state } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/projects");
      assert.equal(response.status, 401);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "UNAUTHORIZED",
      );
    } finally {
      state.index.close();
    }
  });

  it("returns directory listings with shallow project signals and hidden filtering", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const root = await tempHome("nerve-fs-routes-");
      const jsProject = join(root, "js-app");
      const pyProject = join(root, "py-tool");
      const hiddenProject = join(root, ".hidden-app");
      await mkdir(join(jsProject, ".git"), { recursive: true });
      await mkdir(pyProject, { recursive: true });
      await mkdir(hiddenProject, { recursive: true });
      await writeFile(join(jsProject, "package.json"), "{}\n");
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
      await writeFile(
        join(pyProject, "pyproject.toml"),
        '[project]\nname = "py-tool"\n',
      );

      const response = await app.request(
        `/api/filesystem/directories?path=${encodeURIComponent(root)}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        path: string;
        signals: string[];
        entries: Array<{ name: string; signals: string[] }>;
      };
      assert.equal(body.path, root);
      assert.ok(body.signals.includes("workspace"));
      assert.equal(
        body.entries.some((entry) => entry.name === ".hidden-app"),
        false,
      );
      assert.deepEqual(
        body.entries.find((entry) => entry.name === "js-app")?.signals,
        ["git", "package"],
      );
      assert.deepEqual(
        body.entries.find((entry) => entry.name === "py-tool")?.signals,
        ["python"],
      );

      const withHidden = await app.request(
        `/api/filesystem/directories?path=${encodeURIComponent(root)}&showHidden=true`,
        { headers },
      );
      assert.equal(withHidden.status, 200);
      assert.ok(
        (
          (await withHidden.json()) as { entries: Array<{ name: string }> }
        ).entries.some((entry) => entry.name === ".hidden-app"),
      );
    } finally {
      state.index.close();
    }
  });

  it("previews files outside the selected project from absolute paths", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-fs-project-");
      const outsideRoot = await tempHome("nerve-fs-outside-");
      const insidePath = join(projectRoot, "inside.txt");
      const outsidePath = join(outsideRoot, "outside.txt");
      await writeFile(insidePath, "inside file\n");
      await writeFile(outsidePath, "outside file\n");
      const project = await state.registry.createProject({ dir: projectRoot });

      const outsideResponse = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=${encodeURIComponent(outsidePath)}`,
        { headers },
      );
      assert.equal(outsideResponse.status, 200);
      const outsideBody = (await outsideResponse.json()) as {
        path: string;
        relativePath: string;
        type: string;
        text?: string;
      };
      assert.equal(outsideBody.path, outsidePath);
      assert.equal(outsideBody.relativePath, outsidePath);
      assert.equal(outsideBody.type, "text");
      assert.equal(outsideBody.text, "outside file\n");

      const insideResponse = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=inside.txt`,
        { headers },
      );
      assert.equal(insideResponse.status, 200);
      const insideBody = (await insideResponse.json()) as {
        path: string;
        relativePath: string;
        text?: string;
      };
      assert.equal(insideBody.path, insidePath);
      assert.equal(insideBody.relativePath, "inside.txt");
      assert.equal(insideBody.text, "inside file\n");
    } finally {
      state.index.close();
    }
  });

  it("returns a line-aware preview window for large text files", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const projectRoot = await tempHome("nerve-fs-large-project-");
      const filePath = join(projectRoot, "large.txt");
      const targetLine = 12_000;
      const lines = Array.from({ length: 15_000 }, (_, index) => {
        const line = index + 1;
        const marker = line === targetLine ? " TARGET-LINE" : "";
        return `line ${line.toString().padStart(5, "0")}${marker} ${"x".repeat(90)}`;
      });
      await writeFile(filePath, `${lines.join("\n")}\n`);
      const project = await state.registry.createProject({ dir: projectRoot });

      const response = await app.request(
        `/api/filesystem/file?projectId=${encodeURIComponent(project.id)}&path=large.txt&line=${targetLine}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        lineStart?: number;
        targetLine?: number;
        text?: string;
        truncated: boolean;
      };
      assert.equal(body.truncated, true);
      assert.equal(body.targetLine, targetLine);
      assert.ok((body.lineStart ?? 0) > 1);
      assert.ok((body.lineStart ?? Number.MAX_SAFE_INTEGER) <= targetLine);
      assert.match(body.text ?? "", /line 12000 TARGET-LINE/);
      assert.doesNotMatch(body.text ?? "", /line 00001/);
    } finally {
      state.index.close();
    }
  });

  it("saves pasted clipboard images to the temp nerve directory", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    let filePath: string | undefined;
    try {
      const response = await app.request("/api/filesystem/clipboard-image", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Screenshot 2026-06-03.png",
          type: "image/png",
          dataBase64: Buffer.from([1, 2, 3]).toString("base64"),
        }),
      });
      assert.equal(response.status, 200);

      const body = (await response.json()) as { path: string };
      filePath = body.path;
      assert.ok(body.path.startsWith(`${join(tmpdir(), "nerve")}/`));
      assert.match(body.path, /\/screenshot-2026-06-03-\d{8}T\d{6}Z\.png$/);
      assert.deepEqual(Array.from(await readFile(body.path)), [1, 2, 3]);
    } finally {
      if (filePath) await rm(filePath, { force: true });
      state.index.close();
    }
  });

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

  it("returns representative project, conversation, agent, and process log responses", async () => {
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

      const processRecord = await state.registry.startProcess({
        cwd: state.storage.paths.home,
        command: `${process.execPath} -e "console.log('route-log')"`,
      });
      await delay(100);
      const logs = await app.request(
        `/api/processes/${processRecord.id}/logs`,
        {
          headers,
        },
      );
      assert.equal(logs.status, 200);
      const body = (await logs.json()) as {
        process: { id: string };
        events: Array<{ line: string }>;
      };
      assert.equal(body.process.id, processRecord.id);
      assert.ok(body.events.some((event) => event.line.includes("route-log")));
    } finally {
      state.index.close();
    }
  });
});
