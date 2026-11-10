import assert from "node:assert/strict";
import test from "node:test";
import { processFooter } from "./process-footer.js";

void test("footer is the exit code, with a duration only above one second", () => {
  assert.equal(processFooter({ exitCode: 0, durationMs: 900 }), "exit 0");
  assert.equal(processFooter({ exitCode: 0, durationMs: 1000 }), "exit 0");
  assert.equal(
    processFooter({ exitCode: 1, durationMs: 12_400 }),
    "exit 1 · 12.4s",
  );
});

void test("non-exit outcomes stay distinguishable", () => {
  assert.equal(
    processFooter({ exitCode: 124, timedOut: true, durationMs: 30_000 }),
    "timed out · exit 124 · 30.0s",
  );
  assert.equal(
    processFooter({ exitCode: 128, signal: "SIGKILL" }),
    "signal SIGKILL · exit 128",
  );
  assert.equal(processFooter({ status: "running" }), "running");
  assert.equal(processFooter({ status: "completed" }), "exit unknown");
});
