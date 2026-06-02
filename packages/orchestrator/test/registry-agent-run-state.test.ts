import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { HttpError } from "../src/registry.js";
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

async function createState(prefix = "nerve-registry-agent-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  return state;
}

async function createProjectSessionAgent() {
  const state = await createState();
  const project = await state.registry.createProject({
    dir: state.storage.paths.home,
  });
  const session = await state.registry.createSession({ projectId: project.id });
  const agent = await state.registry.createAgent({
    projectId: project.id,
    sessionId: session.id,
  });
  return { state, project, session, agent };
}

describe("RuntimeRegistry agent run state", () => {
  it("rejects a new prompt while an agent is already busy", async () => {
    const { state, agent } = await createProjectSessionAgent();
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
      });

      await assert.rejects(
        () => state.registry.promptAgent(agent.id, { text: "again" }),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "AGENT_BUSY",
      );
    } finally {
      state.index.close();
    }
  });

  it("treats aborting an idle agent as a no-op", async () => {
    const { state, agent } = await createProjectSessionAgent();
    try {
      await state.registry.abortAgent(agent.id);
      await state.registry.abortAgent(agent.id);
      assert.equal(state.registry.getAgent(agent.id).status, "idle");
    } finally {
      state.index.close();
    }
  });

  it("enforces child-agent budget and authority constraints", async () => {
    const { state, project, session } = await createProjectSessionAgent();
    try {
      const exhaustedParent = await state.registry.createAgent({
        projectId: project.id,
        sessionId: session.id,
        budget: { depth: 0, maxDepth: 3, maxRuns: 1, usedRuns: 1 },
      });
      await assert.rejects(
        () =>
          state.registry.createAgent({
            projectId: project.id,
            sessionId: session.id,
            parentAgentId: exhaustedParent.id,
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 403 &&
          error.code === "SUBAGENT_BUDGET_EXHAUSTED",
      );

      const scopedParent = await state.registry.createAgent({
        projectId: project.id,
        sessionId: session.id,
        mode: "planning",
        permissionLevel: "read_only",
      });
      await assert.rejects(
        () =>
          state.registry.createAgent({
            projectId: project.id,
            sessionId: session.id,
            parentAgentId: scopedParent.id,
            mode: "coding",
            permissionLevel: "supervised",
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 403 &&
          error.code === "SUBAGENT_AUTHORITY_EXCEEDED",
      );
    } finally {
      state.index.close();
    }
  });
});
