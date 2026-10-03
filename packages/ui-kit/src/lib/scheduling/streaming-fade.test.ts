import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_FRESH_CHUNKS, StreamingFadeTracker } from "./streaming-fade.js";

describe("StreamingFadeTracker", () => {
  it("never fades text that was visible at creation", () => {
    const tracker = new StreamingFadeTracker({ initialText: "hello" });
    assert.deepEqual(tracker.segments(0, 5, 0), [
      { start: 0, end: 5, fresh: false, ageMs: 0 },
    ]);
  });

  it("records one chunk per append and reports its age", () => {
    const tracker = new StreamingFadeTracker({ fadeMs: 200 });
    tracker.update("ab", 0);
    tracker.update("abcd", 16);
    assert.equal(tracker.freshCount, 2);
    assert.deepEqual(tracker.segments(0, 4, 50), [
      { start: 0, end: 2, fresh: true, ageMs: 50 },
      { start: 2, end: 4, fresh: true, ageMs: 34 },
    ]);
  });

  it("settles chunks once they are older than the fade", () => {
    const tracker = new StreamingFadeTracker({ fadeMs: 200 });
    tracker.update("ab", 0);
    tracker.update("abcd", 150);
    assert.deepEqual(tracker.segments(0, 4, 210), [
      { start: 0, end: 2, fresh: false, ageMs: 0 },
      { start: 2, end: 4, fresh: true, ageMs: 60 },
    ]);
    tracker.prune(210);
    assert.equal(tracker.freshCount, 1);
    assert.equal(tracker.settlesAt, 350);
  });

  it("clears every chunk when the text is rewritten", () => {
    const tracker = new StreamingFadeTracker();
    tracker.update("abc", 0);
    tracker.update("xbcd", 10);
    assert.equal(tracker.freshCount, 0);
    tracker.update("xb", 20);
    assert.equal(tracker.freshCount, 0);
  });

  it("follows a tail window that drops leading lines while growing", () => {
    const tracker = new StreamingFadeTracker({
      fadeMs: 200,
      initialText: "a\nb",
    });
    tracker.update("a\nbc", 0);
    // Window keeps the last two lines: "a\n" drops, "\nd" arrives.
    tracker.update("bc\nd", 10);
    assert.deepEqual(tracker.segments(0, 4, 20), [
      { start: 0, end: 1, fresh: false, ageMs: 0 },
      { start: 1, end: 2, fresh: true, ageMs: 20 },
      { start: 2, end: 4, fresh: true, ageMs: 10 },
    ]);
    // The appended range is reported even though the window shifted.
    assert.deepEqual(tracker.lastAppended, { start: 2, end: 4 });
    tracker.update("zz", 30);
    assert.equal(tracker.lastAppended, undefined);
  });

  it("caps live chunks by merging the oldest", () => {
    const tracker = new StreamingFadeTracker({ fadeMs: 10_000 });
    let text = "";
    for (let index = 0; index < MAX_FRESH_CHUNKS + 5; index += 1) {
      text += "x";
      tracker.update(text, index);
    }
    assert.equal(tracker.freshCount, MAX_FRESH_CHUNKS);
    const segments = tracker.segments(0, text.length, 100);
    assert.equal(segments[0]!.start, 0);
    assert.equal(segments.at(-1)!.end, text.length);
    assert.ok(segments.every((segment) => segment.fresh));
  });

  it("clips segments to a moving window", () => {
    const tracker = new StreamingFadeTracker({
      fadeMs: 200,
      initialText: "0123",
    });
    tracker.update("01234567", 0);
    assert.deepEqual(tracker.segments(2, 6, 10), [
      { start: 2, end: 4, fresh: false, ageMs: 0 },
      { start: 4, end: 6, fresh: true, ageMs: 10 },
    ]);
    assert.deepEqual(tracker.segments(5, 5, 10), []);
  });
});
