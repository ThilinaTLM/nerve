import assert from "node:assert/strict";
import { test } from "node:test";
import { restartGpuProcess } from "../src/window/gpu-process.js";

test("restartGpuProcess kills only the GPU process", () => {
  const killed: Array<[number, string]> = [];
  const pid = restartGpuProcess({
    getAppMetrics: () => [
      { pid: 10, type: "Browser" },
      { pid: 11, type: "GPU" },
      { pid: 12, type: "Tab" },
    ],
    kill: (target, signal) => killed.push([target, signal]),
  });
  assert.equal(pid, 11);
  assert.deepEqual(killed, [[11, "SIGKILL"]]);
});

test("restartGpuProcess is a no-op without a GPU process", () => {
  const pid = restartGpuProcess({
    getAppMetrics: () => [{ pid: 10, type: "Browser" }],
    kill: () => assert.fail("must not kill"),
  });
  assert.equal(pid, undefined);
});
