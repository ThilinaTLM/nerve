import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlowControl } from "../src/protocol/flow-control.js";

describe("sandbox protocol client flow control", () => {
  it("bounds inflight event batches", () => {
    const flow = new FlowControl(2);
    assert.equal(flow.canSend(), true);
    flow.sent();
    flow.sent();
    assert.equal(flow.canSend(), false);
    flow.acked();
    assert.equal(flow.canSend(), true);
  });
});
