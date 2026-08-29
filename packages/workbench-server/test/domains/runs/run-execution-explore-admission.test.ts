import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRecord } from "@nervekit/contracts";
import { WorkbenchExploreAdmission } from "../../../src/domains/agents/execution/workbench-explore-admission.js";
import {
  WorkbenchRunExecutionFactory,
  type WorkbenchRunExecutionAdapter,
} from "../../../src/domains/runs/adapters/workbench-run-execution.js";
import { WorkbenchLiveExecutions } from "../../../src/domains/runs/application/run-live-executions.js";
import type {
  RunExecutionOutcome,
  RunExecutionSink,
} from "../../../src/domains/runs/runtime/index.js";

function factoryFor(
  admission: WorkbenchExploreAdmission,
  outcome: RunExecutionOutcome,
): WorkbenchRunExecutionFactory {
  const adapter: WorkbenchRunExecutionAdapter = {
    create: async () => ({
      control: {
        steer: async () => undefined,
        followUp: async () => undefined,
        removeQueuedPrompt: async () => false,
        forcePush: async () => undefined,
        continue: async () => undefined,
        cancel: async () => undefined,
      },
      execute: async () => outcome,
    }),
  };
  return new WorkbenchRunExecutionFactory(
    adapter,
    new WorkbenchLiveExecutions(),
    admission,
  );
}

async function execute(
  factory: WorkbenchRunExecutionFactory,
  runId: string,
): Promise<void> {
  const run = { runId } as RunRecord;
  const execution = await factory.create(run, {} as RunExecutionSink);
  await execution.execute({
    run,
    command: "start",
    signal: new AbortController().signal,
  });
}

describe("run-scoped Explore admission lifecycle", () => {
  it("retains launch accounting while a parent run is suspended", async () => {
    const admission = new WorkbenchExploreAdmission();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();

    await execute(factoryFor(admission, { status: "suspended" }), "run_parent");

    assert.throws(
      () => admission.reserveBatch("run_parent", 1),
      /Explore is unavailable/,
    );
  });

  it("clears launch accounting after a terminal parent outcome", async () => {
    const admission = new WorkbenchExploreAdmission();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();
    admission.reserveBatch("run_parent", 8).finish();

    await execute(factoryFor(admission, { status: "completed" }), "run_parent");

    assert.doesNotThrow(() => admission.reserveBatch("run_parent", 8).finish());
  });
});
