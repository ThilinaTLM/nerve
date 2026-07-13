import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Virtualizer } from "@tanstack/svelte-virtual";
import {
  captureItemKeySnapshot,
  createItemKeyAccessor,
  deriveVirtualDomIdentities,
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

  it("keeps old and new accessors closed over immutable snapshots", () => {
    const items: Item[] = [{ key: "a" }, { key: "draft" }, { key: "z" }];
    const previousSnapshot = capture(items);
    const previousAccessor = createItemKeyAccessor(previousSnapshot);

    items[1] = { key: "tool" };
    const nextSnapshot = capture(items);
    const nextAccessor = createItemKeyAccessor(nextSnapshot);

    assert.deepEqual([0, 1, 2].map(previousAccessor), ["a", "draft", "z"]);
    assert.deepEqual([0, 1, 2].map(nextAccessor), ["a", "tool", "z"]);
    assert.ok(Object.isFrozen(previousSnapshot));
    assert.ok(Object.isFrozen(nextSnapshot));
  });

  it("refreshes TanStack interior virtual keys with a new accessor", () => {
    const previous = capture([{ key: "a" }, { key: "draft" }, { key: "z" }]);
    const next = capture([{ key: "a" }, { key: "tool" }, { key: "z" }]);
    const virtualizer = new Virtualizer<HTMLDivElement, HTMLElement>({
      count: previous.length,
      getScrollElement: () => null,
      estimateSize: () => 20,
      getItemKey: createItemKeyAccessor(previous),
      observeElementRect: () => () => {},
      observeElementOffset: () => () => {},
      scrollToFn: () => {},
      initialRect: { width: 200, height: 200 },
      initialOffset: 0,
    });

    assert.deepEqual(
      virtualizer.getVirtualItems().map((item) => item.key),
      ["a", "draft", "z"],
    );
    virtualizer.setOptions({
      ...virtualizer.options,
      getItemKey: createItemKeyAccessor(next),
    });
    assert.deepEqual(
      virtualizer.getVirtualItems().map((item) => item.key),
      ["a", "tool", "z"],
    );
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

  it("distinguishes string/number keys and disambiguates duplicates", () => {
    const identities = deriveVirtualDomIdentities([1, "1", 1, "1"]);

    assert.notEqual(encodeItemKey(1), encodeItemKey("1"));
    assert.deepEqual(
      identities.map((identity) => identity.domKey),
      [
        "number:1",
        'string:"1"',
        "number:1:duplicate:1",
        'string:"1":duplicate:1',
      ],
    );
    assert.equal(
      new Set(identities.map((identity) => identity.domKey)).size,
      4,
    );
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
