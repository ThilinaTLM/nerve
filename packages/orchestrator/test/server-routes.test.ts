import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
