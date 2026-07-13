import {
  assertStatus,
  invariant,
  normalizedToolProjection,
} from "./assertions.js";
import type {
  RealHostRunMatrixFixture,
  RealHostScenarioSummary,
} from "./fixture.js";

export async function runToolLifecycleScenario(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  const session = await fixture.prepare({
    name: "tools",
    permissionLevel: "autonomous",
    steps: [
      {
        type: "toolCall",
        id: "parity_read_1",
        name: "read",
        args: { path: "package.json", offset: 1, limit: 2 },
      },
      { type: "assistantText", text: "The parity read completed." },
    ],
  });
  try {
    const runId = await session.start("Read the workspace package manifest.");
    const state = await session.waitForStatus(runId, ["completed"]);
    assertStatus(state, "completed");
    const revisions = normalizedToolProjection(state).filter(
      (tool) => tool.toolName === "read",
    );
    invariant(revisions.length >= 2, "Tool lifecycle was not durably revised");
    invariant(
      revisions.some((tool) => tool.status === "running"),
      "Missing running tool revision",
    );
    invariant(
      revisions.some((tool) => tool.status === "completed" && tool.hasResult),
      "Missing completed tool result revision",
    );
    invariant(
      revisions.every(
        (tool, index) =>
          index === 0 || tool.revision > revisions[index - 1]!.revision,
      ),
      "Tool revisions were not ordered",
    );
    const tools = await session.tools(runId);
    const latest = tools.find((tool) => tool.toolName === "read");
    invariant(latest?.status === "completed", "Latest tool was not completed");
    const toolEvents = (await session.events(runId)).filter(
      (event) => event.type === "toolCall.updated",
    );
    invariant(
      toolEvents.length === revisions.length,
      "Tool event count diverged from durable lifecycle revisions",
    );
    return { name: session.name, runs: 1, assertions: 7 };
  } finally {
    await session.dispose();
  }
}
