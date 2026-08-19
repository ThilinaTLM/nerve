import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTaskSupervisor } from "../src/domains/tasks/task-supervisor.js";

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "nerve-worker-runtime-"));
  return createTaskSupervisor(home);
}

test("captures immediate worker exit and close outcomes", async () => {
  const supervisor = await fixture();
  const spawned = await supervisor.spawn("printf done", {
    executionId: "runtime_immediate",
    cwd: process.cwd(),
  });
  assert.equal((await spawned.exited).kind, "closed");
  assert.equal((await spawned.closed).kind, "closed");
  assert.equal((await spawned.runtime).platform, process.platform);
});

test("reattaches to a serialized worker execution", async () => {
  const supervisor = await fixture();
  const spawned = await supervisor.spawn("sleep 30", {
    executionId: "runtime_reattach",
    cwd: process.cwd(),
  });
  const runtime = await spawned.runtime;
  try {
    assert.equal(await supervisor.isRuntimeTargetAlive(runtime), true);
    const attached = await supervisor.attach(runtime);
    assert.equal(
      (await attached.runtime).workerExecutionId,
      "runtime_reattach",
    );
  } finally {
    await supervisor.terminate(spawned.child, "SIGKILL");
    await spawned.closed;
  }
});
