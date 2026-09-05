import assert from "node:assert/strict";
import test from "node:test";
import { WorkbenchRunQuery } from "../../../src/domains/runs/application/workbench-run-query.js";

test("an off-branch blocked settlement remains visible without leaking abandoned live output", async () => {
  const settlement = { id: "approval:checkpoint_test", phase: "blocked" };
  const query = new WorkbenchRunQuery(
    {
      listActive: async () => [
        {
          run: {
            runId: "run_test",
            agentId: "agent_test",
            projectId: "proj_test",
            conversationId: "conv_test",
            status: "settling",
            lastCheckpointId: "checkpoint_test",
            createdAt: "2026-09-05T06:00:00.000Z",
          },
          checkpoints: [
            {
              checkpointId: "checkpoint_test",
              harnessLeafId: "entry_old_branch",
            },
          ],
          prompts: [],
          transitions: [],
        },
      ],
      approvalSettlementForRun: async () => settlement,
    } as never,
    {
      conversationRuntime: {
        snapshotForConversation: () => ({
          turns: [{ turnId: "turn_abandoned" }],
          toolOutputsByToolCallId: { tool_old: "abandoned output" },
        }),
      },
    } as never,
  );
  const snapshot = await query.activeForConversation("conv_test", [
    "entry_new_branch",
  ]);
  assert.equal(snapshot?.status, "settling");
  assert.equal(snapshot?.settlement, settlement);
  assert.deepEqual(snapshot?.turns, []);
  assert.deepEqual(snapshot?.toolOutputsByToolCallId, {});
});
