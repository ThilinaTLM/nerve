import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkbenchRunCancellation } from "../../../src/domains/runs/adapters/workbench-run-cancellation.js";

describe("run tool cancellation", () => {
  it("fences work even on retries with no active tools, including uncertain leased tools", async () => {
    const records = [
      { id: "proposal_claimed", runId: "run_test", status: "running" },
      { id: "proposal_unclaimed", runId: "run_test", status: "committed" },
    ];
    const calls: string[][] = [];
    const cancellation = new WorkbenchRunCancellation(
      {} as never,
      {
        listToolCalls: () => records,
        terminateNonTerminalToolCallsForRun: async () => {
          records[0] = {
            ...records[0]!,
            status: "cancelled",
            errorDetails: { code: "TOOL_OUTCOME_UNKNOWN" },
          } as never;
          records[1] = { ...records[1]!, status: "cancelled" };
          return [];
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        fenceCancelledRunToolWork: async (input: {
          unknownProposalIds: string[];
        }) => {
          calls.push(input.unknownProposalIds);
          return calls.length === 1 ? [{ id: "work_ready" }] : [];
        },
      } as never,
    );
    assert.equal(
      await cancellation.cancelTools({ runId: "run_test" } as never),
      "confirmed",
    );
    assert.equal(
      await cancellation.cancelTools({ runId: "run_test" } as never),
      "not_running",
    );
    assert.deepEqual(calls, [["proposal_claimed"], ["proposal_claimed"]]);
  });
});
