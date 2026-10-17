import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChipOrder, chipKey } from "./chip-order";

const texts = (items: { text: string }[]) => items.map((item) => item.text);

describe("ChipOrder", () => {
  it("keys by explicit key, falling back to text", () => {
    assert.equal(chipKey({ key: "lead", text: "queued" }), "lead");
    assert.equal(chipKey({ text: "grep" }), "grep");
  });

  it("appends new chips at the end and keeps earlier chips in place", () => {
    const order = new ChipOrder();
    assert.deepEqual(texts(order.order([{ key: "lead", text: "drafting" }])), [
      "drafting",
    ]);
    // A risk chip arrives, then the lead chip text changes: positions hold.
    const next = order.order([
      { key: "risk", text: "destructive" },
      { key: "lead", text: "needs approval" },
    ]);
    assert.deepEqual(texts(next), ["needs approval", "destructive"]);
    const later = order.order([
      { key: "extra", text: "3 files" },
      { key: "risk", text: "destructive" },
      { key: "lead", text: "4.2s" },
    ]);
    assert.deepEqual(texts(later), ["4.2s", "destructive", "3 files"]);
  });

  it("keeps the slot of a chip that disappears and returns", () => {
    const order = new ChipOrder();
    order.order([
      { key: "a", text: "a" },
      { key: "b", text: "b" },
    ]);
    order.order([{ key: "b", text: "b" }]);
    assert.deepEqual(
      texts(
        order.order([
          { key: "b", text: "b" },
          { key: "a", text: "a" },
        ]),
      ),
      ["a", "b"],
    );
  });

  it("collapses duplicate keys to the first occurrence", () => {
    const order = new ChipOrder();
    assert.deepEqual(
      texts(
        order.order([
          { key: "x", text: "first" },
          { key: "x", text: "second" },
        ]),
      ),
      ["first"],
    );
  });
});
