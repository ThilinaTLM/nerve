import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalSettlementService } from "../../../src/domains/human-input/approval-settlement.service.js";

test("one unreadable approval does not prevent unrelated recovery", async () => {
  const normalized: string[] = [];
  let errors = 0;
  const service = new ApprovalSettlementService({
    repository: {
      journal: { onCommit: () => () => undefined },
      list: async () => [],
      normalize: async (_conversationId: string, tool: { id: string }) => {
        normalized.push(tool.id);
        return {
          id: "approval_good",
          phase: "blocked",
          conversationId: "conv_good",
        };
      },
    },
    runs: {
      listApprovalRecoveryInteractions: async () =>
        ["bad", "good"].map((id) => ({
          conversationId: `conv_${id}`,
          runId: `run_${id}`,
          toolCallId: `tool_${id}`,
          interactionOrdinal: 0,
        })),
    },
    tools: {
      listApprovals: () => [],
      getToolCallDetails: async (id: string) => {
        if (id === "tool_bad") throw new Error("Corrupt record");
        return {
          id,
          conversationId: "conv_good",
          interactions: [{ status: "resolved" }],
        };
      },
    },
    logger: {
      error: async () => {
        errors++;
      },
    },
  } as never);
  try {
    await service.start();
    assert.deepEqual(normalized, ["tool_good"]);
    assert.equal(errors, 1);
  } finally {
    await service.stop();
  }
});
