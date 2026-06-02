import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createOrchestratorState } from "../src/server.js";
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

async function createState(prefix = "nerve-registry-session-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  return state;
}

const oldSessionId = "ses_01HN0000000000000000000000";
const oldAgentId = "agent_01HN0000000000000000000000";
const firstEntryId = "entry_01HN0000000000000000000000";
const secondEntryId = "entry_01HN0000000000000000000001";
const createdAt = "2026-01-01T00:00:00.000Z";

describe("RuntimeRegistry session behavior", () => {
  it("creates projects, sessions, and agents through public APIs", async () => {
    const state = await createState();
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

      assert.equal(state.registry.getProject(project.id).id, project.id);
      assert.equal(
        state.registry.getSession(session.id).activeAgentId,
        agent.id,
      );
      assert.equal(state.registry.getAgent(agent.id).sessionId, session.id);
    } finally {
      state.index.close();
    }
  });

  it("imports, navigates, exports, and remaps session entries", async () => {
    const state = await createState("nerve-registry-import-");
    try {
      const imported = await state.registry.importSession({
        project: { dir: state.storage.paths.home, name: "Imported Project" },
        session: {
          title: "Imported Session",
          mode: "coding",
          permissionLevel: "supervised",
        },
        agents: [
          {
            id: oldAgentId,
            sessionId: oldSessionId,
            projectId: "proj_01HN0000000000000000000000",
            projectDir: state.storage.paths.home,
            rootAgentId: oldAgentId,
            mode: "coding",
            permissionLevel: "supervised",
            workspaceScope: { roots: [state.storage.paths.home] },
            budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
            status: "idle",
            createdAt,
            updatedAt: createdAt,
          },
        ],
        entries: [
          {
            id: firstEntryId,
            sessionId: oldSessionId,
            agentId: oldAgentId,
            role: "user",
            kind: "message",
            text: "Hello",
            createdAt,
          },
          {
            id: secondEntryId,
            sessionId: oldSessionId,
            agentId: oldAgentId,
            parentEntryId: firstEntryId,
            role: "assistant",
            kind: "message",
            text: "Hi there",
            createdAt,
          },
        ],
      });

      assert.equal(imported.entries.length, 2);
      assert.notEqual(imported.session.id, oldSessionId);
      assert.notEqual(imported.agents[0]?.id, oldAgentId);
      assert.notEqual(imported.entries[0]?.id, firstEntryId);
      assert.equal(imported.entries[1]?.parentEntryId, imported.entries[0]?.id);
      assert.equal(imported.session.activeEntryId, imported.entries[1]?.id);

      await state.registry.navigateSession(imported.session.id, {
        activeEntryId: imported.entries[0]?.id ?? null,
      });
      assert.deepEqual(
        state.registry
          .getSessionEntries(imported.session.id)
          .map((entry) => entry.text),
        ["Hello"],
      );

      const exported = state.registry.exportSession(imported.session.id);
      assert.equal(exported.entries.length, 2);
      assert.equal(exported.entries[1]?.parentEntryId, exported.entries[0]?.id);
    } finally {
      state.index.close();
    }
  });
});
