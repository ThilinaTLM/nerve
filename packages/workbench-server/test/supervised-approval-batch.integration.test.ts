import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import type { RunHydratedState } from "@nervekit/host-runtime";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
} from "../src/app/orchestrator-state.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

describe("supervised approval batches", () => {
  it("exposes and resolves every first-turn sequential approval before resuming", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-supervised-batch-"));
    const provider = `nerve-scripted-supervised-batch-${process.pid}-${Date.now()}`;
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCalls",
          calls: [
            {
              id: "provider_batch_first",
              name: "bash",
              args: { command: "printf batch-first" },
            },
            {
              id: "provider_batch_second",
              name: "bash",
              args: { command: "printf batch-second" },
            },
            {
              id: "provider_batch_third",
              name: "bash",
              args: { command: "printf batch-third" },
            },
          ],
        },
        {
          type: "assistantText",
          text: "All three approved commands settled.",
        },
      ],
    });
    const storage = await initializeStorage(root);
    const orchestrator = createOrchestratorState(storage, "127.0.0.1", 0);
    const runs = new WorkbenchRunUnitOfWork(storage.paths.home, 0);

    try {
      await orchestrator.events.hydrate();
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const agent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        projectDir: root,
        model: { provider, modelId: "scripted-fast" },
        permissionLevel: "supervised",
      });

      await orchestrator.registry.promptAgent(agent.id, {
        text: "Run three supervised commands.",
      });
      const waiting = await waitForRun(runs, agent.id, ["waiting"]);
      const runId = waiting.run.runId;
      const interactions = waiting.interactions.filter(
        (interaction) => interaction.status === "pending",
      );
      assert.equal(interactions.length, 3);
      assert.ok(
        interactions.every((interaction) => interaction.kind === "approval"),
      );
      assert.equal(
        new Set(interactions.map((item) => item.checkpointId)).size,
        1,
      );

      const batchToolCallIds = interactions[0]?.batchToolCallIds;
      assert.ok(batchToolCallIds);
      assert.equal(batchToolCallIds.length, 3);
      assert.ok(
        interactions.every(
          (interaction) =>
            JSON.stringify(interaction.batchToolCallIds) ===
            JSON.stringify(batchToolCallIds),
        ),
      );

      const toolsById = new Map(
        orchestrator.registry.tools
          .listToolCalls()
          .filter((tool) => tool.runId === runId)
          .map((tool) => [tool.id, tool]),
      );
      assert.deepEqual(
        batchToolCallIds.map(
          (toolCallId) => toolsById.get(toolCallId)?.providerToolCallId,
        ),
        [
          "provider_batch_first",
          "provider_batch_second",
          "provider_batch_third",
        ],
      );
      assert.ok(
        batchToolCallIds.every(
          (toolCallId) =>
            toolsById.get(toolCallId)?.status === "pending_approval",
        ),
      );

      const approvalsByToolCallId = new Map(
        orchestrator.registry.tools
          .listApprovals("pending")
          .filter((approval) => batchToolCallIds.includes(approval.toolCallId))
          .map((approval) => [approval.toolCallId, approval]),
      );
      assert.equal(approvalsByToolCallId.size, 3);
      const waitingSnapshot =
        await orchestrator.registry.getConversationSnapshot(conversation.id);
      assert.equal(
        waitingSnapshot.toolCalls.filter(
          (tool) => tool.runId === runId && tool.status === "pending_approval",
        ).length,
        3,
      );

      await orchestrator.registry.grantApproval(
        approvalsByToolCallId.get(batchToolCallIds[1]!)!.id,
      );
      await assertBatchStillWaiting(runs, runId, batchToolCallIds);
      assert.deepEqual(approvalStatuses(orchestrator, batchToolCallIds), [
        "pending",
        "granted",
        "pending",
      ]);
      await orchestrator.registry.grantApproval(
        approvalsByToolCallId.get(batchToolCallIds[0]!)!.id,
      );
      await assertBatchStillWaiting(runs, runId, batchToolCallIds);
      assert.deepEqual(approvalStatuses(orchestrator, batchToolCallIds), [
        "granted",
        "granted",
        "pending",
      ]);
      await orchestrator.registry.grantApproval(
        approvalsByToolCallId.get(batchToolCallIds[2]!)!.id,
      );

      const completed = await waitForRun(runs, agent.id, ["completed"]);
      assert.equal(completed.run.runId, runId);
      assert.equal(
        completed.transitions.filter(
          (transition) => transition.kind === "resumed",
        ).length,
        1,
      );
      assert.equal(
        completed.transitions.filter(
          (transition) => transition.kind === "interaction_batch_resolved",
        ).length,
        1,
      );
      assert.ok(
        completed.interactions.every(
          (interaction) => interaction.status === "resolved",
        ),
      );

      const completedTools = orchestrator.registry.tools
        .listToolCalls()
        .filter((tool) => batchToolCallIds.includes(tool.id));
      assert.equal(completedTools.length, 3);
      assert.ok(completedTools.every((tool) => tool.status === "completed"));

      const completedSnapshot =
        await orchestrator.registry.getConversationSnapshot(conversation.id);
      const toolResultEntries = completedSnapshot.entries.filter((entry) => {
        const details = record(entry.details);
        return batchToolCallIds.includes(String(details.toolRecordId ?? ""));
      });
      assert.deepEqual(
        toolResultEntries.map((entry) => record(entry.details).toolRecordId),
        batchToolCallIds,
      );
      assert.deepEqual(
        toolResultEntries.map((entry) => record(entry.details).toolCallId),
        [
          "provider_batch_first",
          "provider_batch_second",
          "provider_batch_third",
        ],
      );
      assert.ok(
        completedSnapshot.entries.some(
          (entry) =>
            entry.role === "assistant" &&
            entry.text.includes("All three approved commands settled."),
        ),
      );
    } finally {
      registration.unregister();
      await shutdownOrchestratorState(orchestrator);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    }
  });

  it("exposes every ask_user call and resumes only after all are settled", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-question-batch-"));
    const provider = `nerve-scripted-question-batch-${process.pid}-${Date.now()}`;
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCalls",
          calls: [
            {
              id: "provider_question_first",
              name: "ask_user",
              args: { question: "First question?" },
            },
            {
              id: "provider_question_second",
              name: "ask_user",
              args: { question: "Second question?" },
            },
          ],
        },
        { type: "assistantText", text: "Both questions settled." },
      ],
    });
    const storage = await initializeStorage(root);
    const orchestrator = createOrchestratorState(storage, "127.0.0.1", 0);
    const runs = new WorkbenchRunUnitOfWork(storage.paths.home, 0);

    try {
      await orchestrator.events.hydrate();
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const agent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        projectDir: root,
        model: { provider, modelId: "scripted-fast" },
        permissionLevel: "supervised",
      });

      await orchestrator.registry.promptAgent(agent.id, {
        text: "Ask both questions.",
      });
      const waiting = await waitForRun(runs, agent.id, ["waiting"]);
      const pendingInteractions = waiting.interactions.filter(
        (interaction) => interaction.status === "pending",
      );
      assert.equal(pendingInteractions.length, 2);
      assert.ok(
        pendingInteractions.every(
          (interaction) => interaction.kind === "question",
        ),
      );
      const questions = orchestrator.registry.tools
        .listUserQuestions("pending")
        .filter((question) =>
          pendingInteractions.some(
            (interaction) => interaction.toolCallId === question.toolCallId,
          ),
        );
      assert.equal(questions.length, 2);
      const byText = new Map(
        questions.map((question) => [question.question, question]),
      );

      await orchestrator.registry.answerUserQuestion(
        byText.get("Second question?")!.id,
        "second answer",
      );
      const partiallyResolved = await runs.load(waiting.run.runId);
      assert.equal(partiallyResolved?.run.status, "waiting");
      assert.equal(
        partiallyResolved?.interactions.filter(
          (interaction) => interaction.status === "pending",
        ).length,
        1,
      );
      assert.equal(
        orchestrator.registry.tools.listUserQuestions("pending").length,
        1,
      );

      await orchestrator.registry.dismissUserQuestion(
        byText.get("First question?")!.id,
        "Skipped in test.",
      );
      const completed = await waitForRun(runs, agent.id, ["completed"]);
      assert.equal(
        completed.transitions.filter(
          (transition) => transition.kind === "resumed",
        ).length,
        1,
      );
      assert.equal(
        completed.interactions.filter(
          (interaction) => interaction.status === "resolved",
        ).length,
        2,
      );

      const snapshot = await orchestrator.registry.getConversationSnapshot(
        conversation.id,
      );
      const questionToolResults = snapshot.entries.filter((entry) => {
        const details = record(entry.details);
        return pendingInteractions.some(
          (interaction) => interaction.toolCallId === details.toolRecordId,
        );
      });
      assert.deepEqual(
        questionToolResults.map((entry) => record(entry.details).toolCallId),
        ["provider_question_first", "provider_question_second"],
      );
    } finally {
      registration.unregister();
      await shutdownOrchestratorState(orchestrator);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    }
  });
});

async function assertBatchStillWaiting(
  runs: WorkbenchRunUnitOfWork,
  runId: string,
  batchToolCallIds: readonly string[],
): Promise<void> {
  const state = await runs.load(runId);
  assert.equal(state?.run.status, "waiting");
  assert.equal(
    state?.transitions.some((transition) => transition.kind === "resumed"),
    false,
  );
  assert.ok(
    state?.interactions.every(
      (interaction) => interaction.status === "pending",
    ),
  );
  const latestTools = latestToolCalls(state);
  assert.ok(
    batchToolCallIds.every(
      (toolCallId) =>
        latestTools.get(toolCallId)?.status === "pending_approval",
    ),
  );
}

function latestToolCalls(
  state: RunHydratedState | undefined,
): Map<string, { status: string }> {
  const tools = new Map<string, { status: string }>();
  for (const transition of state?.transitions ?? []) {
    for (const tool of transition.toolCalls) tools.set(tool.id, tool);
  }
  return tools;
}

async function waitForRun(
  runs: WorkbenchRunUnitOfWork,
  agentId: string,
  statuses: string[],
): Promise<RunHydratedState> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const states = await runs.list();
    const state = states
      .filter((candidate) => candidate.run.agentId === agentId)
      .at(-1);
    if (state && statuses.includes(state.run.status)) return state;
    if (
      state &&
      ["failed", "cancelled", "interrupted", "cancellation_failed"].includes(
        state.run.status,
      )
    ) {
      throw new Error(
        `Run settled as ${state.run.status}: ${state.run.failure?.message ?? ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for run status ${statuses.join("/")}`);
}

function approvalStatuses(
  orchestrator: ReturnType<typeof createOrchestratorState>,
  batchToolCallIds: readonly string[],
): Array<string | undefined> {
  const byToolCallId = new Map(
    orchestrator.registry.tools
      .listApprovals()
      .map((approval) => [approval.toolCallId, approval.status]),
  );
  return batchToolCallIds.map((toolCallId) => byToolCallId.get(toolCallId));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
