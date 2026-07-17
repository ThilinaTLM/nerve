import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { EventEnvelope } from "@nervekit/contracts";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import {
  createOrchestratorState,
  shutdownOrchestratorState,
} from "../src/app/orchestrator-state.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

describe("workbench live turn events", () => {
  it("publishes one turn start before each tool-driven assistant response", async () => {
    const provider = "nerve-scripted-live-turn-events";
    const registration = registerAgentScriptedProvider({
      provider,
      steps: [
        {
          type: "toolCall",
          id: "call_turn_test",
          name: "bash",
          args: { command: "printf turn-test" },
        },
        { type: "assistantText", text: "Finished after the tool." },
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "nerve-workbench-turn-events-"));
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
        model: { provider, modelId: "scripted-fast" },
      });

      await orchestrator.registry.promptAgent(agent.id, {
        text: "Use a tool, then answer.",
      });
      await waitFor(() =>
        events.some((event) => event.type === "run.completed"),
      );

      const turnEvents = events.filter(
        (event) => event.type === "conversation.live.turn.started",
      );
      const messageEvents = events.filter(
        (event) => event.type === "conversation.live.message.started",
      );
      assert.equal(turnEvents.length, 2);
      assert.equal(messageEvents.length, 2);
      assert.deepEqual(
        turnEvents.map((event) => ({
          durability: event.durability,
          turnId: eventData(event).turnId,
          ordinal: eventData(event).ordinal,
        })),
        [
          {
            durability: "transient",
            turnId: eventData(messageEvents[0]!).turnId,
            ordinal: 0,
          },
          {
            durability: "transient",
            turnId: eventData(messageEvents[1]!).turnId,
            ordinal: 1,
          },
        ],
      );
      for (const turnEvent of turnEvents) {
        const messageIndex = events.findIndex(
          (event) =>
            event.type === "conversation.live.message.started" &&
            eventData(event).turnId === eventData(turnEvent).turnId,
        );
        assert.ok(events.indexOf(turnEvent) < messageIndex);
      }
    } finally {
      unsubscribe();
      registration.unregister();
      await shutdownOrchestratorState(orchestrator);
      await rm(root, { recursive: true, force: true });
    }
  });
});

function eventData(event: EventEnvelope): Record<string, unknown> {
  return event.data as Record<string, unknown>;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for workbench live turn events");
}
