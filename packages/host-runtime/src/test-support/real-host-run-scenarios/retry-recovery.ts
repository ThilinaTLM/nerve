import {
  assertRejectsWithCode,
  assertStatus,
  invariant,
  normalizedCheckpointProjection,
  normalizedInteractionProjection,
} from "./assertions.js";
import type {
  CheckpointFault,
  RealHostRunMatrixFixture,
  RealHostScenarioSession,
  RealHostScenarioSummary,
} from "./fixture.js";

export async function runRetryRecoveryScenarios(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  let assertions = 0;

  const retry = await fixture.prepare({
    name: "retry-provider",
    steps: [
      {
        type: "providerError",
        message: "provider returned error 503",
        retryable: true,
      },
      { type: "assistantText", text: "Recovered after retry." },
    ],
  });
  try {
    const runId = await retry.start("Retry exactly once.");
    const state = await retry.waitForStatus(runId, ["completed"]);
    assertStatus(state, "completed");
    invariant(state.run.attempt === 2, "Retry did not create attempt two");
    invariant(
      new Set(
        state.transitions
          .map((transition) => transition.execution?.executionId)
          .filter(Boolean),
      ).size === 2,
      "Retry did not create a distinct execution lineage",
    );
    invariant(
      state.transitions.filter((transition) => transition.kind === "retrying")
        .length === 1,
      "Retrying transition count diverged",
    );
    invariant(
      (await retry.events(runId)).filter(
        (event) => event.type === "run.retrying",
      ).length === 1,
      "Retrying event count diverged",
    );
    const checkpoints = normalizedCheckpointProjection(state);
    invariant(
      checkpoints.some(
        (checkpoint) =>
          checkpoint.boundary === "before_provider_request" &&
          checkpoint.checksum,
      ),
      "Retry checkpoint lineage/checksum was missing",
    );
    assertions += 6;
  } finally {
    await retry.dispose();
  }

  const valid = await questionSession(fixture, "recovery-valid");
  try {
    const runId = await valid.start("Wait, restart, and recover.");
    await valid.waitForStatus(runId, ["waiting"]);
    const before = await valid.pendingInteraction(runId, "question");
    invariant(before, "Missing valid recovery interaction");
    await valid.restart();
    const after = await valid.pendingInteraction(runId, "question");
    invariant(
      after?.interactionId === before.interactionId &&
        after.checkpointId === before.checkpointId,
      "Waiting hydration changed interaction/checkpoint ownership",
    );
    await valid.answerQuestion(after.externalId, "resume");
    const completed = await valid.waitForStatus(runId, ["completed"]);
    assertStatus(completed, "completed");
    invariant(
      normalizedInteractionProjection(completed)[0]?.ownsCheckpoint,
      "Recovered interaction lost its checkpoint reference",
    );
    assertions += 4;
  } finally {
    await valid.dispose();
  }

  for (const fault of ["missing", "stale", "corrupt"] as const) {
    assertions += await invalidCheckpointCase(fixture, fault);
  }

  return { name: "retry-recovery", runs: 5, assertions };
}

async function invalidCheckpointCase(
  fixture: RealHostRunMatrixFixture,
  fault: CheckpointFault,
): Promise<number> {
  const session = await questionSession(fixture, `recovery-${fault}`);
  try {
    const runId = await session.start(`Refuse a ${fault} checkpoint.`);
    await session.waitForStatus(runId, ["waiting"]);
    const pending = await session.pendingInteraction(runId, "question");
    invariant(pending, `Missing ${fault} checkpoint interaction`);
    await session.faultCheckpoint(runId, fault);
    await assertRejectsWithCode(
      () => session.answerQuestion(pending.externalId, "must not resume"),
      "INVALID_CHECKPOINT",
    );
    await assertRejectsWithCode(
      () => session.continue(runId),
      "INVALID_CHECKPOINT",
    );
    const refused = await session.load(runId);
    invariant(refused, `Faulted ${fault} run disappeared`);
    invariant(
      refused.run.status === "suspended",
      `Faulted ${fault} run settled as ${refused.run.status}`,
    );
    invariant(
      !refused.transitions.some((transition) =>
        ["retrying", "completed"].includes(transition.kind),
      ),
      `Faulted ${fault} checkpoint launched an execution`,
    );
    invariant(
      refused.run.failure?.code !== "RUN_EXECUTION_FAILED",
      `Faulted ${fault} checkpoint escaped into execution`,
    );
    return 6;
  } finally {
    await session.dispose();
  }
}

function questionSession(
  fixture: RealHostRunMatrixFixture,
  name: string,
): Promise<RealHostScenarioSession> {
  return fixture.prepare({
    name,
    steps: [
      {
        type: "toolCall",
        id: `question_parity_${name.replaceAll("-", "_")}`,
        name: "ask_user",
        args: { question: "Resume this checkpoint?" },
      },
      { type: "assistantText", text: "Checkpoint recovery completed." },
    ],
  });
}
