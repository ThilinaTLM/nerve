import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  await state.registry.hydrate();
  const app = createApp(state);
  const headers = { authorization: `Bearer ${storage.localToken}` };
  return { app, state, headers };
}

describe("orchestrator server routes", () => {
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

  it("returns representative project, session, agent, and process log responses", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const session = await state.registry.createSession({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        sessionId: session.id,
      });

      const projects = await app.request("/api/projects", { headers });
      assert.equal(projects.status, 200);
      assert.equal(
        ((await projects.json()) as { projects: unknown[] }).projects.length,
        1,
      );

      const sessions = await app.request("/api/sessions", { headers });
      assert.equal(sessions.status, 200);
      assert.equal(
        ((await sessions.json()) as { sessions: unknown[] }).sessions.length,
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
