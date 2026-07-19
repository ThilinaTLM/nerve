import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkbenchSubagentExecutions } from "../src/domains/agents/run/workbench-subagent-executions.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("WorkbenchSubagentExecutions", () => {
  it("aborts every parallel child before awaiting child cleanup", async () => {
    const executions = new WorkbenchSubagentExecutions();
    const cleanup = deferred();
    const started: string[] = [];
    executions.register("run_parent", "run_child_1", async () => {
      started.push("child_1");
      await cleanup.promise;
    });
    executions.register("run_parent", "run_child_2", () => {
      started.push("child_2");
    });

    const cancellation = executions.cancelRun("run_parent");
    assert.deepEqual(started, ["child_1", "child_2"]);
    cleanup.resolve();

    assert.equal(await cancellation, 2);
  });

  it("unregisters completed children", async () => {
    const executions = new WorkbenchSubagentExecutions();
    const unregister = executions.register(
      "run_parent",
      "run_child",
      () => undefined,
    );
    unregister();

    assert.equal(await executions.cancelRun("run_parent"), 0);
  });
});
