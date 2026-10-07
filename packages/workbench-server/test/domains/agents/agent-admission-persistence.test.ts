import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { AsyncSubagentRepository } from "../../../src/domains/agents/async-subagent.repository.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";

it("copies/restarts durable admission reservations, queued assignment correlation and team stop generations without re-admission", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-admission-storage-"));
  const source = join(home, "source.sqlite"),
    copied = join(home, "copied.sqlite");
  const original = new CanonicalStore(source, { readerCount: 0 });
  await original.initialize();
  const repo = new AsyncSubagentRepository(original);
  try {
    const assignment = {
      runId: "run_reserved",
      childId: "agent_child",
      leadId: "agent_parent",
      generation: 3,
      childGeneration: 7,
    };
    await repo.writeControl({
      agentId: "agent_parent",
      generation: 3,
      stopped: true,
      stopping: false,
    });
    await repo.writeControl({
      agentId: "agent_child",
      generation: 7,
      stopped: false,
      stopping: false,
      reservedRunId: assignment.runId,
    });
    await repo.reserveAssignment(assignment);
    await repo.reserveAssignment(assignment);
    await original.close();
    await copyFile(source, copied);
    const restarted = new CanonicalStore(copied, { readerCount: 0 });
    await restarted.initialize();
    try {
      const restored = new AsyncSubagentRepository(restarted);
      assert.equal(
        (await restored.control("agent_child")).reservedRunId,
        "run_reserved",
      );
      assert.equal((await restored.control("agent_parent")).stopped, true);
      assert.equal((await restored.control("agent_parent")).generation, 3);
      assert.deepEqual(await restored.assignments(), [assignment]);
      await assert.rejects(
        restored.reserveAssignment({ ...assignment, childId: "agent_sibling" }),
        /identity conflict/,
      );
      assert.deepEqual(await restored.assignments(), [assignment]);
    } finally {
      await restarted.close();
    }
  } finally {
    await original.close();
    await rm(home, { recursive: true, force: true });
  }
});
