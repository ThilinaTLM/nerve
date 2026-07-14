import {
  assertStatus,
  invariant,
  normalizedInteractionProjection,
} from "./assertions.js";
import {
  REAL_HOST_PLAN_PATH,
  type RealHostRunMatrixFixture,
  type RealHostScenarioSession,
  type RealHostScenarioSummary,
  type RealHostScriptedStep,
} from "./fixture.js";

export async function runInteractionScenarios(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  let assertions = 0;
  await withSession(
    fixture,
    {
      name: "interaction-question-restart",
      steps: [
        {
          type: "toolCall",
          id: "question_parity_1",
          name: "ask_user",
          args: { question: "What is the parity value?" },
        },
        { type: "assistantText", text: "The answer was recorded once." },
      ],
    },
    async (session) => {
      const runId = await session.start("Ask one parity question.");
      const waiting = await session.waitForStatus(runId, ["waiting"]);
      assertWaiting(waiting, "question");
      await session.restart();
      const pending = await session.pendingInteraction(runId, "question");
      invariant(pending, "Question was not hydrated after restart");
      await session.answerQuestion(pending.externalId, "42");
      const completed = await session.waitForStatus(runId, ["completed"]);
      assertResolvedContinuation(completed, "question");
      assertions += 6;
    },
  );

  for (const decision of ["deny", "allow"] as const) {
    await withSession(
      fixture,
      {
        name: `interaction-approval-${decision}`,
        permissionLevel: "supervised",
        steps: approvalSteps(decision),
      },
      async (session) => {
        const runId = await session.start(`Exercise approval ${decision}.`);
        const waiting = await session.waitForStatus(runId, ["waiting"]);
        assertWaiting(waiting, "approval");
        const pending = await session.pendingInteraction(runId, "approval");
        invariant(pending, "Approval was not exposed by the host");
        await session.resolveApproval(pending.externalId, decision);
        const completed = await session.waitForStatus(runId, ["completed"]);
        assertResolvedContinuation(completed, "approval");
        const tools = await session.tools(runId);
        invariant(
          tools.some((tool) =>
            decision === "deny"
              ? tool.status === "denied" || tool.status === "error"
              : tool.status === "completed",
          ),
          `Approval ${decision} did not settle its tool call`,
        );
        assertions += 7;
      },
    );
  }

  await withSession(
    fixture,
    {
      name: "interaction-plan-changes-accept",
      mode: "planning",
      permissionLevel: "autonomous",
      planContent: "# Parity plan\n\n1. Exercise shared host parity.\n",
      steps: [
        planStep("plan_review_parity_1", "Parity plan"),
        planStep("plan_review_parity_2", "Parity plan revised"),
        { type: "assistantText", text: "The accepted plan is complete." },
      ],
    },
    async (session) => {
      const runId = await session.start("Present the parity plan.");
      await session.waitForStatus(runId, ["waiting"]);
      const first = await session.pendingInteraction(runId, "plan_review");
      invariant(first, "First plan review was not exposed");
      await session.resolvePlan(
        first.externalId,
        "request_changes",
        "Clarify the parity step.",
      );
      await waitForDifferentPlan(session, runId, first.interactionId);
      const second = await session.pendingInteraction(runId, "plan_review");
      invariant(
        second && second.interactionId !== first.interactionId,
        "Revised plan did not create a new review",
      );
      await session.resolvePlan(second.externalId, "accept");
      const completed = await session.waitForStatus(runId, ["completed"]);
      assertStatus(completed, "completed");
      const projections = normalizedInteractionProjection(completed).filter(
        (interaction) => interaction.kind === "plan_review",
      );
      invariant(projections.length === 2, "Expected two plan interactions");
      invariant(
        projections.every(
          (interaction) =>
            interaction.status === "resolved" &&
            interaction.ownsCheckpoint &&
            interaction.resolutionCount === 1,
        ),
        "Plan interaction resolution/checkpoint ownership diverged",
      );
      invariant(
        completed.transitions.filter((item) => item.kind === "resumed")
          .length === 2,
        "Plan review did not resume exactly twice",
      );
      invariant(
        !completed.transitions
          .flatMap((transition) => transition.events)
          .some((event) => event.type === "run.retrying"),
        "Plan review emitted a false retry event",
      );
      assertions += 7;
    },
  );

  return { name: "interactions", runs: 4, assertions };
}

function approvalSteps(decision: "deny" | "allow"): RealHostScriptedStep[] {
  return [
    {
      type: "toolCall",
      id: `approval_parity_${decision}`,
      name: "bash",
      args: { command: "printf parity-approval" },
    },
    { type: "assistantText", text: `Approval ${decision} settled once.` },
  ];
}

function planStep(id: string, title: string): RealHostScriptedStep {
  return {
    type: "toolCall",
    id,
    name: "plan_mode_present",
    args: { file_path: REAL_HOST_PLAN_PATH, title },
  };
}

function assertWaiting(
  state: Awaited<ReturnType<RealHostScenarioSession["load"]>>,
  kind: "question" | "approval" | "plan_review",
): void {
  invariant(state, "Waiting run was not stored");
  assertStatus(state, "waiting");
  const projection = normalizedInteractionProjection(state);
  invariant(
    projection.some(
      (interaction) =>
        interaction.kind === kind &&
        interaction.status === "pending" &&
        interaction.ownsCheckpoint,
    ),
    `${kind} wait did not own a valid suspension checkpoint`,
  );
}

function assertResolvedContinuation(
  state: NonNullable<Awaited<ReturnType<RealHostScenarioSession["load"]>>>,
  kind: "question" | "approval",
): void {
  assertStatus(state, "completed");
  const projection = normalizedInteractionProjection(state).filter(
    (interaction) => interaction.kind === kind,
  );
  invariant(projection.length === 1, `Expected one ${kind} interaction`);
  invariant(
    projection[0]?.status === "resolved" &&
      projection[0].ownsCheckpoint &&
      projection[0].resolutionCount === 1,
    `${kind} resolution was not unique or checkpoint-owned`,
  );
  invariant(
    state.transitions.filter((item) => item.kind === "resumed").length === 1,
    `${kind} resolution did not resume exactly once`,
  );
  invariant(
    !state.transitions
      .flatMap((transition) => transition.events)
      .some((event) => event.type === "run.retrying"),
    `${kind} resolution emitted a false retry event`,
  );
}

async function waitForDifferentPlan(
  session: RealHostScenarioSession,
  runId: string,
  previousId: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const pending = await session.pendingInteraction(runId, "plan_review");
    if (pending && pending.interactionId !== previousId) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for revised plan interaction");
}

async function withSession(
  fixture: RealHostRunMatrixFixture,
  options: Parameters<RealHostRunMatrixFixture["prepare"]>[0],
  action: (session: RealHostScenarioSession) => Promise<void>,
): Promise<void> {
  const session = await fixture.prepare(options);
  try {
    await action(session);
  } finally {
    await session.dispose();
  }
}
