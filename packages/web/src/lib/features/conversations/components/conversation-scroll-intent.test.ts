import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldDisableFollowForScroll } from "./conversation-scroll-intent";

describe("shouldDisableFollowForScroll", () => {
  it("ignores upward scrolls with no explicit scroll-away intent", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: false,
        scrollDelta: -24,
        userScrollAwayIntent: false,
        scrollbarPointerActive: false,
      }),
      false,
    );
  });

  it("disables follow for explicit upward user scrolls away from the bottom", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: false,
        scrollDelta: -24,
        userScrollAwayIntent: true,
        scrollbarPointerActive: false,
      }),
      true,
    );
  });

  it("does not disable follow for downward user scrolls", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: false,
        scrollDelta: 24,
        userScrollAwayIntent: true,
        scrollbarPointerActive: false,
      }),
      false,
    );
  });

  it("ignores tiny upward deltas below the configured epsilon", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: false,
        scrollDelta: -0.5,
        userScrollAwayIntent: true,
        scrollbarPointerActive: false,
        epsilon: 1,
      }),
      false,
    );
  });

  it("disables follow while the native scrollbar is active", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: false,
        scrollDelta: 0,
        userScrollAwayIntent: false,
        scrollbarPointerActive: true,
      }),
      true,
    );
  });

  it("never disables follow while already at the bottom", () => {
    assert.equal(
      shouldDisableFollowForScroll({
        atEnd: true,
        scrollDelta: -24,
        userScrollAwayIntent: true,
        scrollbarPointerActive: true,
      }),
      false,
    );
  });
});
