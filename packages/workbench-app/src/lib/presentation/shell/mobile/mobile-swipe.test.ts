import assert from "node:assert/strict";
import test from "node:test";
import {
  SWIPE_ACTION_WIDTH,
  classifySwipeIntent,
  exceedsLongPressSlop,
  settleSwipe,
  swipeOffset,
  swipeRestOffset,
  swipeWidth,
} from "./mobile-swipe.js";

const widths = { leading: 76, trailing: 152 };

test("intent stays pending until the finger moves past the slop", () => {
  assert.equal(classifySwipeIntent(3, 2), "pending");
});

test("mostly vertical motion never becomes a swipe", () => {
  assert.equal(classifySwipeIntent(10, 30), "vertical");
  assert.equal(classifySwipeIntent(14, 12), "vertical");
});

test("clearly horizontal motion becomes a swipe in either direction", () => {
  assert.equal(classifySwipeIntent(24, 4), "horizontal");
  assert.equal(classifySwipeIntent(-24, 4), "horizontal");
});

test("long-press tolerates small jitter only", () => {
  assert.equal(exceedsLongPressSlop(4, 4), false);
  assert.equal(exceedsLongPressSlop(12, 3), true);
});

test("offset follows the finger and resists past the revealed width", () => {
  assert.equal(swipeOffset(0, 40, widths), 40);
  assert.equal(swipeOffset(0, -100, widths), -100);
  const past = swipeOffset(0, 300, widths);
  assert.ok(past > widths.leading && past <= widths.leading * 1.2);
  const none = swipeOffset(0, 50, { leading: 0, trailing: 152 });
  assert.equal(none, 0);
});

test("an open row can be dragged closed from its rest offset", () => {
  assert.equal(swipeOffset(-152, 100, widths), -52);
});

test("release opens past the threshold, otherwise snaps closed", () => {
  assert.equal(settleSwipe(40, 0, widths), "leading");
  assert.equal(settleSwipe(20, 0, widths), undefined);
  assert.equal(settleSwipe(-70, 0, widths), "trailing");
  assert.equal(settleSwipe(-30, 0, widths), undefined);
});

test("a fast flick decides regardless of distance", () => {
  assert.equal(settleSwipe(-10, -0.8, widths), "trailing");
  assert.equal(settleSwipe(70, -0.8, widths), undefined);
  assert.equal(settleSwipe(10, 0.8, widths), "leading");
});

test("sides without actions never open", () => {
  assert.equal(settleSwipe(60, 0, { leading: 0, trailing: 152 }), undefined);
});

test("rest offsets and widths", () => {
  assert.equal(swipeRestOffset("leading", widths), 76);
  assert.equal(swipeRestOffset("trailing", widths), -152);
  assert.equal(swipeRestOffset(undefined, widths), 0);
  assert.equal(swipeWidth(3), SWIPE_ACTION_WIDTH * 2);
  assert.equal(swipeWidth(0), 0);
});
