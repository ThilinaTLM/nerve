import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ToolCallRecord } from "@nerve/shared";
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

  it("allows mode-only updates while an agent is running", async () => {
    const { state, agent } = await createProjectSessionAgent();
    let runtimeMode: string | undefined;
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
        updateAgentRuntimeConfig: async (updated) => {
          runtimeMode = updated.mode;
        },
      });

      const updated = await state.registry.configureAgent(agent.id, {
        mode: "planning",
      });

      assert.equal(updated.mode, "planning");
      assert.equal(state.registry.getAgent(agent.id).mode, "planning");
      assert.equal(runtimeMode, "planning");
    } finally {
      state.index.close();
    }
  });

  it("still rejects non-mode config updates while an agent is running", async () => {
    const { state, agent } = await createProjectSessionAgent();
    try {
      state.registry.runs.set(agent.id, {
        runId: "run_01HN0000000000000000000000",
        abort: () => undefined,
        messages: [],
      });

      await assert.rejects(
        () =>
          state.registry.configureAgent(agent.id, {
            permissionLevel: "supervised",
          }),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "AGENT_BUSY",
      );
    } finally {
      state.index.close();
    }
  });

  it("accepts a suspended plan by appending an implementation instruction and continuing", async () => {
    const { state, agent } = await createProjectSessionAgent();
    let continued = false;
    try {
      await state.registry.configureAgent(agent.id, { mode: "planning" });
      const { review } = await createPendingPlanReviewSuspension(state, agent.id);
      (state.registry as unknown as { agentRunner: { continueAgent: (agentId: string) => Promise<void> } }).agentRunner.continueAgent = async () => {
        continued = true;
      };

      await state.registry.acceptPlanReview(review.id);

      assert.equal(state.registry.getAgent(agent.id).mode, "coding");
      assert.equal(continued, true);
      const entries = state.registry.getSessionEntries(agent.sessionId);
      assert.ok(
        entries.some(
          (entry) =>
            entry.role === "user" &&
            entry.text ===
              `The user accepted the plan at ${review.planPath}. Proceed with the implementation using that plan as the source of truth.`,
        ),
      );
    } finally {
      state.index.close();
    }
  });

  it("rejects a suspended plan without changing mode or continuing", async () => {
    const { state, agent } = await createProjectSessionAgent();
    let continued = false;
    try {
      await state.registry.configureAgent(agent.id, { mode: "planning" });
      const { review, suspension } = await createPendingPlanReviewSuspension(
        state,
        agent.id,
      );
      (state.registry as unknown as { agentRunner: { continueAgent: (agentId: string) => Promise<void> } }).agentRunner.continueAgent = async () => {
        continued = true;
      };

      await state.registry.rejectPlanReview(review.id);

      assert.equal(state.registry.getAgent(agent.id).mode, "planning");
      assert.equal(state.registry.getAgent(agent.id).status, "idle");
      assert.equal(continued, false);
      assert.equal(state.registry.suspensions.getSuspension(suspension.id).status, "cancelled");
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

async function createPendingPlanReviewSuspension(
  state: Awaited<ReturnType<typeof createState>>,
  agentId: string,
) {
  const agent = state.registry.getAgent(agentId);
  const planDir = state.registry.plans.planDir(agent);
  await mkdir(planDir, { recursive: true });
  const planPath = join(planDir, `${agent.id}-implementation.md`);
  await writeFile(planPath, "# Implementation Plan\n\nDo the work.\n", "utf8");

  const toolCall: ToolCallRecord = {
    id: "tool_01HN0000000000000000000000",
    agentId: agent.id,
    sessionId: agent.sessionId,
    projectId: agent.projectId,
    toolName: "plan_mode_present",
    risk: "interaction",
    args: { file_path: planPath },
    cwd: agent.projectDir,
    status: "waiting_for_user",
    runId: "run_01HN0000000000000000000000",
    turnId: "turn_01HN0000000000000000000000",
    sourceToolCallId: "call_plan",
    providerToolCallId: "call_plan",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await (
    state.registry.tools as unknown as {
      upsertToolCall: (toolCall: ToolCallRecord) => Promise<void>;
    }
  ).upsertToolCall(toolCall);
  const review = await state.registry.plans.createPlanReview(toolCall, agent, {
    file_path: planPath,
  });
  const suspension = await state.registry.suspensions.createSuspension({
    agentId: agent.id,
    sessionId: agent.sessionId,
    projectId: agent.projectId,
    runId: "run_01HN0000000000000000000000",
    turnId: "turn_01HN0000000000000000000000",
    toolCallId: toolCall.id,
    providerToolCallId: "call_plan",
    toolName: "plan_mode_present",
    remainingToolCalls: [],
    reason: "Tool plan_mode_present is awaiting user input.",
  });
  return { review, suspension, toolCall };
}
