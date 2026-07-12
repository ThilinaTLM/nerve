import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RpcForwarder } from "../src/protocol/rpc-forwarder.js";

describe("sandbox manager protocol flow control", () => {
  it("rejects commands when pending queue is full", async () => {
    const forwarder = new RpcForwarder("sandbox_test", { maxPending: 1 });
    const socket: { sent?: string; send(data: string): void } = {
      send(data) {
        this.sent = data;
      },
    };
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
    const request = JSON.parse(socket.sent ?? "null");
    forwarder.resolve({
      ...request,
      kind: "response",
      replyTo: request.id,
      data: { result: { ok: true } },
    });
    assert.deepEqual(await pending, { ok: true });
  });
});
