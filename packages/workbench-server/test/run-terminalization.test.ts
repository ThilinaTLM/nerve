import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRecord } from "@nervekit/contracts";
import { WorkbenchRunTerminalization } from "../src/domains/runs/adapters/workbench-run-terminalization.js";

function run(status: RunRecord["status"]): RunRecord {
  return { runId: "run_test", status } as RunRecord;
}

describe("WorkbenchRunTerminalization", () => {
  it("reconciles tools for every terminal run status", async () => {
    const calls: Array<{ runId: string; message: string }> = [];
    const terminalization = new WorkbenchRunTerminalization({
      terminateNonTerminalToolCallsForRun: async (
        runId: string,
        message: string,
      ) => {
        calls.push({ runId, message });
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
    assert.match(calls[0]!.message, /run completed/);
    assert.match(calls[1]!.message, /run failed/);
    assert.match(calls[2]!.message, /run was cancelled/);
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
