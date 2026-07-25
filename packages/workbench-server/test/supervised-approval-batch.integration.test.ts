import type { RunHydratedState } from "@nervekit/host-runtime";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
} from "../src/app/orchestrator-state.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

describe("supervised approval batches", () => {
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
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
