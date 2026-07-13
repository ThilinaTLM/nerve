import {
  assertSingleTerminal,
  assertTerminalEventOnce,
  invariant,
} from "./assertions.js";
import type {
  RealHostRunMatrixFixture,
  RealHostScenarioSummary,
} from "./fixture.js";

export async function runRedeliveryRaceScenarios(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  let assertions = 0;

  const duplicate = await fixture.prepare({
    name: "race-duplicate-cancel",
    steps: [{ type: "waitForAbort" }],
  });
  try {
    const runId = await duplicate.start("Cancel this run twice.");
    await Promise.all([duplicate.cancel(runId), duplicate.cancel(runId)]);
    const state = await duplicate.waitForStatus(runId, ["cancelled"]);
    assertSingleTerminal(state);
    assertTerminalEventOnce(await duplicate.events(runId));
    await duplicate.cancel(runId);
    const unchanged = await duplicate.load(runId);
    invariant(
      unchanged?.run.revision === state.run.revision,
      "Terminal public cancellation callback changed canonical state",
    );
    assertions += 3;
  } finally {
    await duplicate.dispose();
  }

  const race = await fixture.prepare({
    name: "race-cancel-complete",
    steps: [{ type: "assistantText", text: "race ".repeat(20_000) }],
  });
  try {
    const runId = await race.start("Race completion with cancellation.");
    await race.cancel(runId);
    const state = await race.waitForStatus(runId, ["completed", "cancelled"]);
    invariant(
      ["completed", "cancelled"].includes(state.run.status),
      `Cancel/complete race settled as ${state.run.status}`,
    );
    assertSingleTerminal(state);
    assertTerminalEventOnce(await race.events(runId));
    assertions += 3;
  } finally {
    await race.dispose();
  }

  const redelivery = await fixture.prepare({
    name: "redelivery-marker-restart",
    steps: [{ type: "assistantText", text: "Publish once." }],
  });
  try {
    const runId = await redelivery.start(
      "Complete and redeliver idempotently.",
    );
    const completed = await redelivery.waitForStatus(runId, ["completed"]);
    const completionIntent = completed.transitions
      .flatMap((transition) => transition.events)
      .find((event) => event.type === "run.completed");
    invariant(completionIntent, "Missing completion event intent");
    const before = (await redelivery.events(runId)).filter(
      (event) => event.type === "run.completed",
    );
    invariant(before.length === 1, "Completion was initially published twice");
    await redelivery.removeDeliveryMarker(runId, "run.completed");
    await redelivery.restart();
    const after = (await redelivery.events(runId)).filter(
      (event) => event.type === "run.completed",
    );
    const hydrated = await redelivery.load(runId);
    invariant(
      hydrated?.run.status === "completed",
      "Terminal hydration diverged",
    );
    invariant(
      hydrated.deliveries.filter(
        (delivery) => delivery.intentId === completionIntent.id,
      ).length === 1,
      "Redelivery did not restore exactly one delivery marker",
    );
    invariant(after.length === 1, "Redelivery duplicated the durable event");
    invariant(
      after[0]?.id === before[0]?.id,
      "Idempotent redelivery changed the durable event ID",
    );
    const snapshot = await redelivery.snapshot(runId);
    invariant(
      snapshot.status === "completed",
      "Hydrated terminal snapshot diverged",
    );
    assertions += 7;
  } finally {
    await redelivery.dispose();
  }

  return { name: "redelivery-races", runs: 3, assertions };
}
