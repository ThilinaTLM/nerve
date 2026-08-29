import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRecord } from "@nervekit/contracts";
import type { ToolTerminationOutcome } from "../../../src/domains/tools/execution/tool-termination.js";
import { WorkbenchRunTerminalization } from "../../../src/domains/runs/adapters/workbench-run-terminalization.js";

function run(status: RunRecord["status"]): RunRecord {
  return { runId: "run_test", status } as RunRecord;
}

describe("WorkbenchRunTerminalization", () => {
  it("reconciles tools for every terminal run status", async () => {
    const calls: Array<{
      runId: string;
      outcome: ToolTerminationOutcome;
    }> = [];
    const terminalization = new WorkbenchRunTerminalization({
      terminateNonTerminalToolCallsForRun: async (
        runId: string,
        outcome: ToolTerminationOutcome,
      ) => {
        calls.push({ runId, outcome });
        return [];
      },
    } as never);

    await terminalization.terminalize(run("completed"));
    await terminalization.terminalize(run("failed"));
    await terminalization.terminalize(run("cancelled"));

    assert.deepEqual(
      calls.map((call) => call.runId),
      ["run_test", "run_test", "run_test"],
    );
    assert.equal(calls[0]!.outcome.status, "failed");
    assert.equal(calls[0]!.outcome.code, "interrupted");
    assert.match(calls[0]!.outcome.message, /run completed/);
    assert.equal(calls[1]!.outcome.status, "failed");
    assert.equal(calls[1]!.outcome.code, "interrupted");
    assert.match(calls[1]!.outcome.message, /run failed/);
    assert.equal(calls[2]!.outcome.status, "cancelled");
    assert.equal(calls[2]!.outcome.code, "cancelled");
    assert.match(calls[2]!.outcome.message, /run was cancelled/);
  });

  it("does not reconcile resumable run statuses", async () => {
    let calls = 0;
    const terminalization = new WorkbenchRunTerminalization({
      terminateNonTerminalToolCallsForRun: async () => {
        calls += 1;
        return [];
      },
    } as never);

    for (const status of [
      "running",
      "retrying",
      "waiting",
      "suspended",
      "interrupted",
    ] as const) {
      await terminalization.terminalize(run(status));
    }

    assert.equal(calls, 0);
  });
});
