import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NotifyEvent } from "@nervekit/contracts/events";
import { OutgoingBufferBudget } from "../../src/streams/outgoing-buffer-budget.js";
import { event } from "../support/events.js";

const notify = { type: "x", data: {} } as unknown as NotifyEvent;

describe("OutgoingBufferBudget", () => {
  it("accepts buffers at the limits without reporting overflow", () => {
    const overflow: string[] = [];
    const budget = new OutgoingBufferBudget(3, 10_000, (m) => overflow.push(m));
    assert.equal(budget.check([event(1), event(2)], [notify]), true);
    assert.equal(budget.check([], []), true);
    assert.deepEqual(overflow, []);
  });

  it("counts live events and notifications together against the event limit", () => {
    const overflow: string[] = [];
    const budget = new OutgoingBufferBudget(2, 10_000, (m) => overflow.push(m));
    assert.equal(budget.check([event(1), event(2)], [notify]), false);
    assert.deepEqual(overflow, ["Outgoing event buffer exceeded"]);
  });

  it("rejects when encoded bytes exceed the byte limit", () => {
    const overflow: string[] = [];
    const budget = new OutgoingBufferBudget(100, 200, (m) => overflow.push(m));
    assert.equal(budget.check([event(1)], []), true);
    assert.equal(budget.check([event(1, { pad: "x".repeat(300) })], []), false);
    assert.equal(overflow.length, 1);
  });
});
