import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  outwardSheetSwipeDistance,
  sheetSwipeAxis,
  sheetSwipeDismissTranslation,
  sheetSwipeTranslation,
  shouldDismissSheetSwipe,
} from "./sheet-swipe";

describe("sheet swipe direction", () => {
  it("moves a left sheet only toward the left edge", () => {
    assert.equal(outwardSheetSwipeDistance("left", -48), 48);
    assert.equal(sheetSwipeTranslation("left", -48), -48);
    assert.equal(sheetSwipeTranslation("left", 48), 0);
  });

  it("moves a right sheet only toward the right edge", () => {
    assert.equal(outwardSheetSwipeDistance("right", 48), 48);
    assert.equal(sheetSwipeTranslation("right", 48), 48);
    assert.equal(sheetSwipeTranslation("right", -48), 0);
  });

  it("pulls a bottom sheet only downward", () => {
    assert.equal(sheetSwipeAxis("bottom"), "y");
    assert.equal(sheetSwipeTranslation("bottom", 48), 48);
    assert.equal(sheetSwipeTranslation("bottom", -48), 0);
    assert.equal(sheetSwipeDismissTranslation("bottom", 300), 300);
  });

  it("treats invalid displacement as no movement", () => {
    assert.equal(sheetSwipeTranslation("left", Number.NaN), 0);
    assert.equal(sheetSwipeTranslation("right", Number.POSITIVE_INFINITY), 0);
  });
});

describe("sheet swipe dismissal", () => {
  it("keeps a short, slow drag open", () => {
    assert.equal(
      shouldDismissSheetSwipe({ distance: 50, size: 320, velocity: 0.2 }),
      false,
    );
  });

  it("dismisses a drag that crosses the distance threshold", () => {
    assert.equal(
      shouldDismissSheetSwipe({ distance: 96, size: 320, velocity: 0.2 }),
      true,
    );
  });

  it("dismisses a short, fast outward flick", () => {
    assert.equal(
      shouldDismissSheetSwipe({ distance: 40, size: 320, velocity: 0.6 }),
      true,
    );
  });

  it("rejects invalid measurements", () => {
    assert.equal(
      shouldDismissSheetSwipe({ distance: 100, size: 0, velocity: 1 }),
      false,
    );
    assert.equal(
      shouldDismissSheetSwipe({
        distance: Number.NaN,
        size: 320,
        velocity: 1,
      }),
      false,
    );
    assert.equal(
      shouldDismissSheetSwipe({
        distance: 100,
        size: 320,
        velocity: Number.POSITIVE_INFINITY,
      }),
      false,
    );
  });
});
