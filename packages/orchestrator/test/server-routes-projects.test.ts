import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../src/http/errors.js";
import { createProjectRoutes } from "../src/routes/project-routes.js";
import type { OrchestratorState } from "../src/app/orchestrator-state.js";
import { createAuthenticatedApp } from "./helpers/server-routes.js";

describe("orchestrator server project and conversation routes", () => {
  it("serves conversation exports as downloadable attachments", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const cases = [
        {
          path: `/api/conversations/${conversation.id}/export`,
          filename: `conversation-${conversation.id}.json`,
          contentType: "application/json",
        },
        {
          path: `/api/conversations/${conversation.id}/export.md`,
          filename: `conversation-${conversation.id}.md`,
          contentType: "text/markdown",
        },
        {
          path: `/api/conversations/${conversation.id}/export.html`,
          filename: `conversation-${conversation.id}.html`,
          contentType: "text/html",
        },
      ];

      for (const item of cases) {
        const response = await app.request(item.path, { headers });
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-disposition") ?? "",
          /^attachment;/,
        );
        assert.match(
          response.headers.get("content-disposition") ?? "",
          new RegExp(`filename="${item.filename}"`),
        );
        assert.match(
          response.headers.get("content-type")?.toLowerCase() ?? "",
          new RegExp(item.contentType),
        );
      }
    } finally {
      state.index.close();
    }
  });

  it("returns structured not-found errors for missing task records", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/tasks/task_missing", {
        headers,
      });

      assert.equal(response.status, 404);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "TASK_NOT_FOUND",
      );
    } finally {
      state.index.close();
    }
  });

  it("opens registered projects in editors through the project API", async () => {
    const calls: Array<{ projectId: string; editor: string }> = [];
    const app = createProjectRoutes({
      registry: {
        openProjectInEditor: async (
          projectId: string,
          request: { editor: "vscode" | "zed" },
        ) => {
          calls.push({ projectId, editor: request.editor });
          return { projectId, editor: request.editor, dir: "/tmp/project" };
        },
      },
    } as unknown as OrchestratorState);

    const response = await app.request(
      "/proj_01HN0000000000000000000000/open-editor",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editor: "vscode" }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { projectId: "proj_01HN0000000000000000000000", editor: "vscode" },
    ]);
    assert.deepEqual(await response.json(), {
      projectId: "proj_01HN0000000000000000000000",
      editor: "vscode",
      dir: "/tmp/project",
    });
  });

  it("returns editor availability errors from the project open API", async () => {
    const app = createProjectRoutes({
      registry: {
        openProjectInEditor: async () => {
          throw new HttpError(
            404,
            "EDITOR_NOT_AVAILABLE",
            "VS Code is not available on this installation.",
          );
        },
      },
    } as unknown as OrchestratorState);

    const response = await app.request(
      "/proj_01HN0000000000000000000000/open-editor",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editor: "vscode" }),
      },
    );

    assert.equal(response.status, 404);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "EDITOR_NOT_AVAILABLE",
    );
  });

  it("prunes old project conversations through the API", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const oldConversation = await state.registry.createConversation({
        projectId: project.id,
      });
      state.registry.conversations.set(oldConversation.id, {
        ...oldConversation,
        updatedAt: "2000-01-01T00:00:00.000Z",
      });

      const response = await app.request(
        `/api/projects/${project.id}/conversations/prune`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            strategy: "olderThanDays",
            olderThanDays: 7,
          }),
        },
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        prunedConversationIds: string[];
        skipped: unknown[];
      };
      assert.deepEqual(body.prunedConversationIds, [oldConversation.id]);
      assert.deepEqual(body.skipped, []);
      assert.throws(() => state.registry.getConversation(oldConversation.id));
    } finally {
      state.index.close();
    }
  });

  it("prunes project conversations by keep-latest count through the API", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const older = await state.registry.createConversation({
        projectId: project.id,
      });
      const newer = await state.registry.createConversation({
        projectId: project.id,
      });
      state.registry.conversations.set(older.id, {
        ...older,
        updatedAt: "2000-01-01T00:00:00.000Z",
      });
      state.registry.conversations.set(newer.id, {
        ...newer,
        updatedAt: "2020-01-01T00:00:00.000Z",
      });

      const response = await app.request(
        `/api/projects/${project.id}/conversations/prune`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ strategy: "keepLatest", keepLatest: 1 }),
        },
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        strategy: string;
        prunedConversationIds: string[];
        skipped: unknown[];
      };
      assert.equal(body.strategy, "keepLatest");
      assert.deepEqual(body.prunedConversationIds, [older.id]);
      assert.deepEqual(body.skipped, []);
      assert.throws(() => state.registry.getConversation(older.id));
      assert.equal(state.registry.getConversation(newer.id).id, newer.id);
    } finally {
      state.index.close();
    }
  });
});
