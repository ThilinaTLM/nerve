import type { RunHydratedState } from "../run-unit-of-work.js";

export interface NormalizedHostRunSnapshot {
  runId: string;
  status: string;
  entries: Array<{ id: string; role: string; text: string }>;
  toolCalls: Array<{ id: string; status: string }>;
}

export interface RealHostRunScenarioFixture {
  start(prompt: string): Promise<string>;
  steer(runId: string, text: string): Promise<void>;
  followUp(runId: string, text: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  waitForTerminal(runId: string): Promise<void>;
  load(runId: string): Promise<RunHydratedState | undefined>;
  snapshot(runId: string): Promise<NormalizedHostRunSnapshot>;
  durableEventTypes(runId: string): Promise<string[]>;
}

export interface RealHostRunScenarioResult {
  transitionKinds: string[];
  eventTypes: string[];
  snapshot: NormalizedHostRunSnapshot;
  promptOrder: string[];
  cancellationStatus: string;
}

/**
 * Shared black-box scenario used by both production host fixtures. The host
 * fixture owns storage, composition, harness, tools, and event delivery; this
 * runner only drives public operations and asserts normalized lifecycle facts.
 */
export async function runRealHostCompletionScenario(
  fixture: RealHostRunScenarioFixture,
): Promise<RealHostRunScenarioResult> {
  const runId = await fixture.start("Reply with a short parity greeting.");
  await fixture.steer(runId, "Include the word steer.");
  await fixture.followUp(runId, "Then include the word follow-up.");
  await fixture.waitForTerminal(runId);
  const state = await fixture.load(runId);
  invariant(state, `Run ${runId} was not durably stored`);
  invariant(state.run.status === "completed", `Run ${runId} did not complete`);
  const transitionKinds = state.transitions.map((item) => item.kind);
  invariant(transitionKinds.includes("started"), "Missing started transition");
  invariant(
    transitionKinds.includes("completed"),
    "Missing completed transition",
  );
  const prompts = [...state.prompts].sort((a, b) => a.ordinal - b.ordinal);
  invariant(prompts.length === 2, "Expected steer and follow-up prompts");
  invariant(
    prompts.every((prompt) => prompt.status === "delivered"),
    "Queued prompts were not delivered",
  );
  invariant(
    prompts[0]?.behavior === "steer" && prompts[1]?.behavior === "follow-up",
    "Prompt ordinal order diverged",
  );
  const entries = state.transitions.flatMap((item) => item.entries);
  invariant(
    entries.some((entry) => entry.role === "assistant"),
    "Missing durable assistant entry",
  );
  const eventTypes = await fixture.durableEventTypes(runId);
  invariant(eventTypes.includes("run.started"), "Missing run.started event");
  invariant(
    eventTypes.includes("run.completed"),
    "Missing run.completed event",
  );
  const snapshot = await fixture.snapshot(runId);
  invariant(snapshot.runId === runId, "Snapshot run identity mismatch");
  invariant(snapshot.status === "completed", "Snapshot is not terminal");
  invariant(
    snapshot.entries.some((entry) => entry.role === "assistant"),
    "Snapshot is missing the assistant entry",
  );
  const cancelledRunId = await fixture.start(
    "Keep running until this parity cancellation arrives.",
  );
  await fixture.followUp(cancelledRunId, "This prompt must be cancelled.");
  await fixture.cancel(cancelledRunId);
  await fixture.waitForTerminal(cancelledRunId);
  const cancelled = await fixture.load(cancelledRunId);
  invariant(cancelled, `Cancelled run ${cancelledRunId} was not stored`);
  invariant(
    cancelled.run.status === "cancelled",
    `Cancellation settled as ${cancelled.run.status}`,
  );
  invariant(
    cancelled.run.cancellationEvidence.every(
      (evidence) =>
        evidence.status === "confirmed" || evidence.status === "not_running",
    ),
    "Cancellation evidence was not truthful and terminal",
  );
  invariant(
    cancelled.prompts.every(
      (prompt) =>
        prompt.status === "delivered" || prompt.status === "cancelled",
    ),
    "Cancellation left a queued prompt",
  );
  return {
    transitionKinds,
    eventTypes,
    snapshot,
    promptOrder: prompts.map((prompt) => prompt.behavior),
    cancellationStatus: cancelled.run.status,
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
