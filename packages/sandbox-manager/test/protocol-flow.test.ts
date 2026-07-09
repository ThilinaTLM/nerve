import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommandForwarder } from "../src/protocol/command-forwarder.js";

describe("sandbox manager protocol flow control", () => {
  it("rejects commands when pending queue is full", async () => {
    const forwarder = new CommandForwarder({ maxPending: 1 });
    const socket = { send: () => undefined };
    const pending = forwarder.send(
      socket,
      "sandbox.status.get",
      {},
      "req_1",
      10_000,
    );
    await assert.rejects(
      () => forwarder.send(socket, "sandbox.status.get", {}, "req_2", 10_000),
      /queue is full/,
    );
    forwarder.resolve("req_1", { ok: true });
    assert.deepEqual(await pending, { ok: true });
  });
});
