import assert from "node:assert/strict";
import test from "node:test";
import { WorkbenchRunService } from "../../../src/domains/runs/application/workbench-run.service.js";

function state(input: {
  runId: string;
  conversationId: string;
  status: "waiting" | "running";
  interactionKind: "approval" | "user_input";
  interactionStatus: "pending" | "resolved";
}) {
  return {
    run: {
      runId: input.runId,
      conversationId: input.conversationId,
      status: input.status,
    },
    interactions: [
      {
        id: `interaction_${input.runId}`,
        runId: input.runId,
        toolCallId: `tool_${input.runId}`,
        kind: input.interactionKind,
        status: input.interactionStatus,
      },
    ],
  };
}

test("pending approval recovery candidates are active and conversation scoped", async () => {
  const wanted = state({
    runId: "wanted",
    conversationId: "conv_target",
    status: "waiting",
    interactionKind: "approval",
    interactionStatus: "pending",
  });
  const service = new WorkbenchRunService(
    {} as never,
    {} as never,
    {
      listActive: async () => [
        wanted,
        state({
          runId: "other_conversation",
          conversationId: "conv_other",
          status: "waiting",
          interactionKind: "approval",
          interactionStatus: "pending",
        }),
        state({
          runId: "wrong_kind",
          conversationId: "conv_target",
          status: "waiting",
          interactionKind: "user_input",
          interactionStatus: "pending",
        }),
        state({
          runId: "resolved",
          conversationId: "conv_target",
          status: "waiting",
          interactionKind: "approval",
          interactionStatus: "resolved",
        }),
        state({
          runId: "not_waiting",
          conversationId: "conv_target",
          status: "running",
          interactionKind: "approval",
          interactionStatus: "pending",
        }),
      ],
    } as never,
    {} as never,
  );

  const interactions =
    await service.listPendingApprovalInteractions("conv_target");

  assert.deepEqual(
    interactions.map((interaction) => interaction.id),
    [wanted.interactions[0]?.id],
  );
});
