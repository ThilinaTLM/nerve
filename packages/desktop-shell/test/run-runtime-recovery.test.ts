import assert from "node:assert/strict";
import test from "node:test";
import { startRunRuntime } from "../src/app/run-runtime-recovery.js";

test("run-runtime startup returns successful daemon state", async () => {
  assert.deepEqual(await startRunRuntime(async () => "ready"), {
    value: "ready",
  });
});

test("run-runtime startup surfaces storage failures unchanged", async () => {
  const failure = new Error("invalid current storage");
  await assert.rejects(
    startRunRuntime(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});
