import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CenterTabScrollSnapshotStore,
  type ScrollPosition,
} from "./center-tab-scroll-restoration.js";

function position(
  path: readonly number[],
  top: number,
  left: number,
  signature = "slot:scroll-area-viewport",
  ordinal = 0,
): ScrollPosition {
  return { path, signature, ordinal, top, left };
}

test("keeps vertical and horizontal positions isolated by center tab", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record("file:a", position([0, 1], 480, 72));
  store.record("diff:b", position([0, 1], 920, 144));

  assert.deepEqual(store.positions("file:a"), [position([0, 1], 480, 72)]);
  assert.deepEqual(store.positions("diff:b"), [position([0, 1], 920, 144)]);
});

test("retains multiple independently located scrollports in one pane", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record(
    "pr:42",
    position([1, 0], 300, 0, "slot:scroll-area-viewport", 0),
  );
  store.record("pr:42", position([1, 2], 640, 18, "codemirror", 0));

  assert.deepEqual(store.positions("pr:42"), [
    position([1, 0], 300, 0, "slot:scroll-area-viewport", 0),
    position([1, 2], 640, 18, "codemirror", 0),
  ]);
});

test("updates a scrollport snapshot without duplicating its stable path", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record(
    "logs:application",
    position([0, 0], 120, 0, "virtual:Application logs"),
  );
  store.record(
    "logs:application",
    position([0, 0], 360, 0, "virtual:Application logs"),
  );

  assert.deepEqual(store.positions("logs:application"), [
    position([0, 0], 360, 0, "virtual:Application logs"),
  ]);
});

test("prunes closed tabs without affecting open tab snapshots", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record("file:open", position([0], 40, 0));
  store.record("file:closed", position([0], 80, 0));

  store.prune(new Set(["file:open"]));

  assert.equal(store.positions("file:closed").length, 0);
  assert.deepEqual(store.positions("file:open"), [position([0], 40, 0)]);
});
