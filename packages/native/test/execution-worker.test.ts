import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExecutionWorkerClient } from "../src/execution-worker-client.js";

async function fixture(): Promise<ExecutionWorkerClient> {
  const home = await mkdtemp(join(tmpdir(), "nerve-execution-worker-"));
  return ExecutionWorkerClient.connect(home);
}

test("starts idempotently and replays durable output by cursor", async () => {
  const client = await fixture();
  const input = {
    executionId: "test_replay",
    command: process.execPath,
    args: ["-e", "console.log('one'); console.error('two')"],
    terminationGraceMs: 100,
    belowNormalPriority: true,
  };
  const first = await client.start(input);
  const duplicate = await client.start(input);
  assert.equal(duplicate.executionId, first.executionId);
  const terminal = await client.subscribe(input.executionId).settled;
  assert.equal(terminal.status, "completed");

  const replay = await client.read(input.executionId, 0);
  assert.deepEqual(
    replay.events
      .filter((event) => event.kind === "output")
      .map((event) => [
        event.stream,
        Buffer.from(event.dataBase64 ?? "", "base64")
          .toString("utf8")
          .trim(),
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    [
      ["stderr", "two"],
      ["stdout", "one"],
    ],
  );
  const after = await client.read(input.executionId, replay.snapshot.cursor);
  assert.equal(after.events.length, 0);

  await assert.rejects(
    client.start({ ...input, args: ["-e", "console.log('different')"] }),
    /launch parameters differ/,
  );
});

test("cancels a worker-owned process tree", async () => {
  const client = await fixture();
  await client.start({
    executionId: "test_cancel",
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    terminationGraceMs: 100,
    belowNormalPriority: true,
  });
  const cancellation = await client.cancel("test_cancel", "SIGKILL");
  assert.equal(cancellation.attempted, true);
  const terminal = await client.subscribe("test_cancel").settled;
  assert.equal(terminal.status, "failed");
});
