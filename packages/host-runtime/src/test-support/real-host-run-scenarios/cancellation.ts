import {
  assertNoUnresolved,
  assertSingleTerminal,
  assertStatus,
  invariant,
} from "./assertions.js";
import {
  REAL_HOST_PLAN_PATH,
  type RealHostRunMatrixFixture,
  type RealHostScenarioPreparation,
  type RealHostScenarioSession,
  type RealHostScenarioSummary,
} from "./fixture.js";

export async function runCancellationScenarios(
  fixture: RealHostRunMatrixFixture,
): Promise<RealHostScenarioSummary> {
  let assertions = 0;

  await cancellationCase(
    fixture,
    { name: "cancel-model", steps: [{ type: "waitForAbort" }] },
    async (session, runId) => session.cancel(runId),
  );
  assertions += 4;

  await cancellationCase(
    fixture,
    {
      name: "cancel-tool",
      permissionLevel: "autonomous",
      steps: [
        {
          type: "toolCall",
          id: "parity_long_tool",
          name: "bash",
          args: {
            command:
              "node -e \"process.on('SIGTERM',()=>{}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)\"",
            timeout: 10,
          },
        },
        { type: "assistantText", text: "The command should not complete." },
      ],
    },
    async (session, runId) => {
      await session.waitForToolStatus(runId, "running");
      const startedAt = Date.now();
      await session.cancel(runId);
      invariant(
        Date.now() - startedAt < 2_000,
        "Run cancellation waited for graceful process timeout",
      );
    },
  );
  assertions += 4;

  await cancellationCase(
    fixture,
    {
      name: "cancel-active-queued-prompt",
      permissionLevel: "autonomous",
      steps: [
        {
          type: "toolCall",
          id: "parity_active_queue_tool",
          name: "bash",
          args: {
            command:
              'node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)"',
            timeout: 10,
          },
        },
        { type: "assistantText", text: "The queued prompt was discarded." },
      ],
    },
    async (session, runId) => {
      await session.waitForToolStatus(runId, "running");
      const promptId = await session.followUp(
        runId,
        "Discard this active queued prompt.",
      );
      const accepted = await session.load(runId);
      invariant(
        accepted?.prompts.find((prompt) => prompt.id === promptId)?.status ===
          "accepted",
        "Active queued prompt was not retained as accepted",
      );
      await session.cancelPrompt(runId, promptId);
      const cancelled = await session.load(runId);
      invariant(
        cancelled?.prompts.find((prompt) => prompt.id === promptId)?.status ===
          "cancelled",
        "Active queued prompt was not cancelled",
      );
      await session.cancel(runId);
    },
  );
  assertions += 6;

  await cancellationCase(
    fixture,
    {
      name: "cancel-queued-prompt",
      steps: questionSteps("question_parity_queue"),
    },
    async (session, runId) => {
      await session.waitForStatus(runId, ["waiting"]);
      const promptId = await session.followUp(
        runId,
        "This queued prompt must be cancelled.",
      );
      await session.cancelPrompt(runId, promptId);
      await session.cancel(runId);
    },
  );
  assertions += 4;

  const interactions: Array<{
    kind: "question" | "approval" | "plan_review";
    options: RealHostScenarioPreparation;
  }> = [
    {
      kind: "question",
      options: {
        name: "cancel-pending-question",
        steps: questionSteps("question_parity_cancel"),
      },
    },
    {
      kind: "approval",
      options: {
        name: "cancel-pending-approval",
        permissionLevel: "supervised",
        steps: [
          {
            type: "toolCall",
            id: "approval_parity_cancel",
            name: "bash",
            args: { command: "printf pending-approval" },
          },
        ],
      },
    },
    {
      kind: "plan_review",
      options: {
        name: "cancel-pending-plan",
        mode: "planning",
        permissionLevel: "autonomous",
        planContent: "# Cancellation plan\n\n1. Wait for cancellation.\n",
        steps: [
          {
            type: "toolCall",
            id: "plan_review_parity_cancel",
            name: "plan_mode_present",
            args: {
              file_path: REAL_HOST_PLAN_PATH,
              title: "Cancellation plan",
            },
          },
        ],
      },
    },
  ];
  for (const item of interactions) {
    await cancellationCase(fixture, item.options, async (session, runId) => {
      await session.waitForStatus(runId, ["waiting"]);
      invariant(
        await session.pendingInteraction(runId, item.kind),
        `Missing pending ${item.kind}`,
      );
      await session.cancel(runId);
    });
    assertions += 5;
  }

  return { name: "cancellation", runs: 6, assertions };
}

function questionSteps(id: string): RealHostScenarioPreparation["steps"] {
  return [
    {
      type: "toolCall",
      id,
      name: "ask_user",
      args: { question: "Should this run remain pending?" },
    },
  ];
}

async function cancellationCase(
  fixture: RealHostRunMatrixFixture,
  options: RealHostScenarioPreparation,
  trigger: (session: RealHostScenarioSession, runId: string) => Promise<void>,
): Promise<void> {
  const session = await fixture.prepare(options);
  try {
    const runId = await session.start(`Run ${options.name}.`);
    await trigger(session, runId);
    const state = await session.waitForStatus(runId, ["cancelled"]);
    assertStatus(state, "cancelled");
    assertSingleTerminal(state);
    invariant(
      state.run.cancellationEvidence.every((evidence) =>
        ["confirmed", "not_running"].includes(evidence.status),
      ),
      "Cancellation evidence was not truthful and terminal",
    );
    assertNoUnresolved(state);
  } finally {
    await session.dispose();
  }
}
