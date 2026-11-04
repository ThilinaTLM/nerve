import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  captureItemKeySnapshot,
  createItemKeyAccessor,
  encodeItemKey,
  itemKeySnapshotsEqual,
  measurementTargetIsCurrent,
  resolveVirtualRowItem,
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

it("a stale row index keeps rendering its own item after an insert", () => {
  const key = (item: { id: string }) => item.id;
  // The virtualizer still holds keys [a, b, c]; an editor row was inserted at 1.
  const items = [{ id: "a" }, { id: "editor" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(resolveVirtualRowItem(items, "a", 0, key), {
    item: items[0],
    index: 0,
  });
  // Row "b" (stale index 1) must not receive the inserted item.
  assert.deepEqual(resolveVirtualRowItem(items, "b", 1, key), {
    item: items[2],
    index: 2,
  });
  assert.deepEqual(resolveVirtualRowItem(items, "c", 2, key), {
    item: items[3],
    index: 3,
  });
});

it("a row whose item was removed renders nothing", () => {
  const key = (item: { id: string }) => item.id;
  const items = [{ id: "a" }, { id: "c" }];
  assert.equal(resolveVirtualRowItem(items, "b", 1, key), undefined);
  assert.equal(resolveVirtualRowItem(items, "z", 5, key), undefined);
});
