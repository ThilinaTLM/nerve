import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

describe("workbench coordinator-owned provider retry", () => {
  it("retries a valid checkpoint and projects completion back to idle", async () => {
    const registration = registerAgentScriptedProvider({
      steps: [
        {
          type: "providerError",
          message: "provider returned error 503",
          retryable: true,
        },
        { type: "assistantText", text: "Recovered after retry." },
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "nerve-workbench-retry-"));
    const storage = await initializeStorage(root);
    const orchestrator = createOrchestratorState(storage, "127.0.0.1", 0);
    try {
      await orchestrator.registry.hydrate();
      const project = await orchestrator.registry.createProject({ dir: root });
      const conversation = await orchestrator.registry.createConversation({
        projectId: project.id,
      });
      const agent = await orchestrator.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-scripted", modelId: "scripted-fast" },
      });
      await orchestrator.registry.promptAgent(agent.id, { text: "Retry once" });
      // This adapter observes a separately owned host, so it must not cache.
      const unitOfWork = new WorkbenchRunUnitOfWork(storage.paths.home, 0);
      let runId: string | undefined;
      await waitFor(async () => {
        const states = await unitOfWork.list();
        runId ??= states.find((state) => state.run.agentId === agent.id)?.run
          .runId;
        if (!runId) return false;
        const state = await unitOfWork.load(runId);
        if (
          state?.run.status === "failed" ||
          state?.run.status === "interrupted"
        ) {
          throw new Error(
            `Retry settled as ${state.run.status}: ${state.run.failure?.message}`,
          );
        }
        return state?.run.status === "completed";
      });
      const state = await unitOfWork.load(runId!);
      assert.equal(state?.run.attempt, 2);
      assert.equal(
        state?.transitions.filter(
          (transition) => transition.kind === "retrying",
        ).length,
        1,
      );
      assert.equal(orchestrator.registry.agents.get(agent.id)?.status, "idle");
    } finally {
      registration.unregister();
      orchestrator.registry.shutdown();
      orchestrator.index.close();
      await rm(root, { recursive: true, force: true });
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
  throw new Error("Timed out waiting for retried workbench run");
}
