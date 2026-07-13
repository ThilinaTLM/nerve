import type { PromptImage } from "@nervekit/contracts";
import {
  assertSingleTerminal,
  assertStatus,
  invariant,
  normalizedDurableProjection,
  normalizedSnapshotProjection,
} from "./assertions.js";
import type {
  RealHostRunMatrixFixture,
  RealHostScenarioSummary,
} from "./fixture.js";

const image: PromptImage = {
  type: "image",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  mimeType: "image/png",
};

export async function runCompletionScenario(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  const session = await fixture.prepare({
    name: "completion",
    steps: [
      { type: "assistantText", text: "Parity response. ".repeat(400) },
      ...Array.from({ length: 5 }, () => ({
        type: "assistantText" as const,
        text: "Parity response.",
      })),
    ],
  });
  try {
    const runId = await session.start("Reply with a short parity greeting.", [
      image,
    ]);
    await session.steer(runId, "Include the word steer.", [image]);
    await session.followUp(runId, "Then include the word follow-up.", [image]);
    const state = await session.waitForStatus(runId, ["completed"]);
    assertStatus(state, "completed");
    assertSingleTerminal(state);
    invariant(
      state.transitions[0]?.kind === "started",
      "First transition was not started",
    );
    const prompts = [...state.prompts].sort((a, b) => a.ordinal - b.ordinal);
    invariant(prompts.length === 2, "Expected steer and follow-up prompts");
    invariant(
      prompts.map((prompt) => prompt.behavior).join(",") === "steer,follow-up",
      "Prompt order diverged",
    );
    invariant(
      prompts.every(
        (prompt) =>
          prompt.status === "delivered" &&
          prompt.images?.length === 1 &&
          prompt.images[0]?.data === image.data &&
          prompt.images[0]?.mimeType === image.mimeType,
      ),
      "Prompt images or delivery state diverged",
    );
    const durable = normalizedDurableProjection(state);
    invariant(
      durable.entries.some((entry) => entry.role === "assistant"),
      "Missing durable terminal assistant entry",
    );
    const events = await session.events(runId);
    invariant(
      events.some((event) => event.type === "run.started"),
      "Missing durable run.started event",
    );
    invariant(
      events.some((event) => event.type === "run.completed"),
      "Missing durable run.completed event",
    );
    const snapshot = await session.snapshot(runId);
    invariant(snapshot.runId === runId, "Snapshot run identity mismatch");
    invariant(
      JSON.stringify(normalizedSnapshotProjection(snapshot)) ===
        JSON.stringify(durable),
      "Normalized snapshot diverged from the durable run journal",
    );
    return { name: session.name, runs: 1, assertions: 10 };
  } finally {
    await session.dispose();
  }
}

export { image as realHostParityImage };
