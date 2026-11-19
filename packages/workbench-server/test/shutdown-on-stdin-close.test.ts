import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { watchStdinForShutdown } from "../src/shutdown-on-stdin-close.js";

function fakeStdin() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { resume: () => emitter });
}

describe("watchStdinForShutdown", () => {
  it("ignores stdin unless the supervisor opted in", () => {
    const stdin = fakeStdin();
    let calls = 0;
    assert.equal(
      watchStdinForShutdown({}, stdin, () => (calls += 1)),
      false,
    );
    stdin.emit("end");
    assert.equal(calls, 0);
  });

  it("requests shutdown when stdin ends or closes", () => {
    const stdin = fakeStdin();
    let calls = 0;
    const env: NodeJS.ProcessEnv = { NERVE_SHUTDOWN_ON_STDIN_CLOSE: "1" };
    assert.equal(
      watchStdinForShutdown(env, stdin, () => (calls += 1)),
      true,
    );
    // Spawned processes (e.g. a nested dev daemon) must not inherit the flag.
    assert.equal(env.NERVE_SHUTDOWN_ON_STDIN_CLOSE, undefined);
    stdin.emit("end");
    assert.equal(calls, 1);
  });
});
