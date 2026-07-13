import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  runRealHostCompletionScenario,
  type RealHostRunScenarioFixture,
} from "@nervekit/host-runtime/test-support";
import type { EventEnvelope } from "@nervekit/contracts";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

describe("workbench real-host run parity", () => {
  it("passes the shared durable completion scenario", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-workbench-parity-"));
    const storage = await initializeStorage(root);
    const orchestrator = createOrchestratorState(storage, "127.0.0.1", 0);
    const events: EventEnvelope[] = [];
    const unsubscribe = orchestrator.events.subscribe((event) =>
      events.push(event),
    );
    try {
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const agent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-faux", modelId: "faux-fast" },
      });
      const unitOfWork = new WorkbenchRunUnitOfWork(storage.paths.home);
      const fixture: RealHostRunScenarioFixture = {
        start: async (prompt) => {
          await orchestrator.registry.promptAgent(agent.id, { text: prompt });
          const started = [...events]
            .reverse()
            .find((event) => event.type === "run.started");
          const runId = (started?.data as { runId?: string } | undefined)
            ?.runId;
          if (!runId) throw new Error("Workbench did not publish run.started");
          return runId;
        },
        steer: async (_runId, text) => {
          await orchestrator.registry.promptAgent(agent.id, {
            text,
            behavior: "steer",
          });
        },
        followUp: async (_runId, text) => {
          await orchestrator.registry.promptAgent(agent.id, {
            text,
            behavior: "follow-up",
          });
        },
        cancel: async () => {
          await orchestrator.registry.abortAgent(agent.id);
        },
        waitForTerminal: async (runId) => {
          await waitFor(async () => {
            const state = await unitOfWork.load(runId);
            return ["completed", "failed", "cancelled"].includes(
              state?.run.status ?? "",
            );
          });
        },
        load: (runId) => unitOfWork.load(runId),
        snapshot: async (runId) => {
          const [snapshot, state] = await Promise.all([
            orchestrator.registry.getConversationSnapshot(conversation.id),
            unitOfWork.load(runId),
          ]);
          return {
            runId,
            status: state?.run.status ?? "missing",
            entries: snapshot.entries
              .filter((entry) => entry.runId === runId)
              .map((entry) => ({
                id: entry.id,
                role: entry.role,
                text: entry.text,
              })),
            toolCalls: snapshot.toolCalls
              .filter((toolCall) => toolCall.runId === runId)
              .map((toolCall) => ({
                id: toolCall.id,
                status: toolCall.status,
              })),
          };
        },
        durableEventTypes: async (runId) => {
          await waitFor(async () =>
            events.some(
              (event) =>
                event.type === "run.completed" &&
                (event.data as { runId?: string } | undefined)?.runId === runId,
            ),
          );
          return events
            .filter(
              (event) =>
                event.durability === "durable" &&
                (event.data as { runId?: string } | undefined)?.runId === runId,
            )
            .map((event) => event.type);
        },
      };
      const result = await runRealHostCompletionScenario(fixture);
      assert.equal(result.transitionKinds[0], "started");
      assert.deepEqual(result.promptOrder, ["steer", "follow-up"]);
      assert.equal(result.cancellationStatus, "cancelled");
    } finally {
      unsubscribe();
      orchestrator.index.close();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    }
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for terminal run state");
}
