import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestGracefulStop } from "../src/daemon/adapters/direct-process.js";

function fakeChild(writable = true) {
  const calls: string[] = [];
  return {
    calls,
    stdin: { writable, end: () => calls.push("stdin.end") },
    kill: (signal: "SIGTERM" | "SIGKILL") => {
      calls.push(signal);
      return true;
    },
  };
}

describe("requestGracefulStop", () => {
  it("ends stdin instead of signalling on win32", () => {
    const child = fakeChild();
    assert.equal(requestGracefulStop(child, "win32"), true);
    assert.deepEqual(child.calls, ["stdin.end"]);
  });

  it("falls back to SIGTERM when stdin is unusable on win32", () => {
    const child = fakeChild(false);
    requestGracefulStop(child, "win32");
    assert.deepEqual(child.calls, ["SIGTERM"]);
  });

  it("keeps SIGTERM on other platforms", () => {
    const child = fakeChild();
    requestGracefulStop(child, "linux");
    assert.deepEqual(child.calls, ["SIGTERM"]);
  });
});
