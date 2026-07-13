import type { PromptImage } from "@nervekit/contracts";
import type { RunHydratedState } from "../run-unit-of-work.js";

export interface NormalizedHostRunSnapshot {
  runId: string;
  status: string;
  entries: Array<{ id: string; role: string; text: string }>;
  toolCalls: Array<{ id: string; status: string }>;
}

export interface RealHostRunScenarioFixture {
  start(prompt: string, images?: PromptImage[]): Promise<string>;
  steer(runId: string, text: string, images?: PromptImage[]): Promise<void>;
  followUp(runId: string, text: string, images?: PromptImage[]): Promise<void>;
  cancel(runId: string): Promise<void>;
  waitForTerminal(runId: string): Promise<void>;
  load(runId: string): Promise<RunHydratedState | undefined>;
  snapshot(runId: string): Promise<NormalizedHostRunSnapshot>;
  durableEventTypes(runId: string): Promise<string[]>;
  prepareCancellation?(): Promise<void>;
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
  const image: PromptImage = {
    type: "image",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    mimeType: "image/png",
  };
  const runId = await fixture.start("Reply with a short parity greeting.", [
    image,
  ]);
  await fixture.steer(runId, "Include the word steer.", [image]);
  await fixture.followUp(runId, "Then include the word follow-up.", [image]);
  await fixture.waitForTerminal(runId);
  const state = await fixture.load(runId);
  invariant(state, `Run ${runId} was not durably stored`);
  invariant(
    state.run.status === "completed",
    `Run ${runId} did not complete: ${state.run.status} ${state.run.failure?.message ?? ""}`,
  );
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
  invariant(
    prompts.every(
      (prompt) =>
        prompt.images?.length === 1 &&
        prompt.images[0]?.data === image.data &&
        prompt.images[0]?.mimeType === image.mimeType,
    ),
    "Prompt images diverged",
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
  await fixture.prepareCancellation?.();
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
