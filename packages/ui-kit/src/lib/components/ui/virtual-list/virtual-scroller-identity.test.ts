import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  captureItemKeySnapshot,
  createItemKeyAccessor,
  encodeItemKey,
  itemKeySnapshotsEqual,
  measurementTargetIsCurrent,
} from "./virtual-scroller-identity";

type Item = { key: string | number };

const capture = (items: readonly Item[]) =>
  captureItemKeySnapshot(items, (item) => item.key);

describe("virtual scroller identity", () => {
  it("detects a middle replacement when count and edge keys are unchanged", () => {
    const previous = capture([{ key: "a" }, { key: "draft" }, { key: "z" }]);
    const next = capture([{ key: "a" }, { key: "tool" }, { key: "z" }]);

    assert.equal(previous.length, next.length);
    assert.equal(previous[0], next[0]);
    assert.equal(previous.at(-1), next.at(-1));
    assert.equal(itemKeySnapshotsEqual(previous, next), false);
  });

  it("captures insert, remove, and reorder accessors correctly", () => {
    const inserted = createItemKeyAccessor(
      capture([{ key: 1 }, { key: 2 }, { key: 3 }]),
    );
    const removed = createItemKeyAccessor(capture([{ key: 1 }, { key: 3 }]));
    const reordered = createItemKeyAccessor(
      capture([{ key: 3 }, { key: 1 }, { key: 2 }]),
    );

    assert.deepEqual([0, 1, 2].map(inserted), [1, 2, 3]);
    assert.deepEqual([0, 1].map(removed), [1, 3]);
    assert.deepEqual([0, 1, 2].map(reordered), [3, 1, 2]);
  });

  it("rejects a delayed measurement after its index is reused", () => {
    const previous = capture([{ key: "a" }, { key: "draft" }, { key: "z" }]);
    const encodedDraft = encodeItemKey("draft");
    assert.equal(measurementTargetIsCurrent(previous, "1", encodedDraft), true);

    const next = capture([{ key: "a" }, { key: "tool" }, { key: "z" }]);
    assert.equal(measurementTargetIsCurrent(next, "1", encodedDraft), false);
    assert.equal(
      measurementTargetIsCurrent(next, "1", encodeItemKey("tool")),
      true,
    );
    assert.equal(measurementTargetIsCurrent(next, "9", encodedDraft), false);
  });
});
