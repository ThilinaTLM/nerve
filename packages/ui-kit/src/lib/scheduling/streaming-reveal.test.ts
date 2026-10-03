import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DONE_FLUSH_S,
  MAX_BACKLOG_CHARS,
  MIN_CPS,
  StreamingRevealPacer,
  TARGET_LAG_S,
  revealBoundary,
} from "./streaming-reveal.js";

const FRAME_MS = 1000 / 60;

function run(pacer: StreamingRevealPacer, ms: number): number {
  let shown = pacer.shownLength;
  for (let t = 0; t < ms; t += FRAME_MS) shown = pacer.advance(FRAME_MS);
  return shown;
}

describe("StreamingRevealPacer", () => {
  it("starts fully revealed so remounts never replay text", () => {
    const pacer = new StreamingRevealPacer(120);
    assert.equal(pacer.shownLength, 120);
    assert.equal(pacer.settled, true);
    assert.equal(pacer.advance(FRAME_MS), 120);
  });

  it("reveals a trickle at the minimum rate", () => {
    const pacer = new StreamingRevealPacer(0);
    pacer.setTarget(5);
    const shown = run(pacer, 50);
    assert.ok(shown >= 1 && shown <= Math.ceil((MIN_CPS * 50) / 1000) + 1);
    assert.equal(run(pacer, 1000), 5);
    assert.equal(pacer.settled, true);
  });

  it("catches up to bursts within the target lag", () => {
    const pacer = new StreamingRevealPacer(0);
    let target = 0;
    // 40-char bursts every 200ms (~200 chars/s) with frames in between.
    for (let burst = 0; burst < 20; burst += 1) {
      target += 40;
      pacer.setTarget(target);
      run(pacer, 200);
    }
    const lagChars = target - pacer.shownLength;
    assert.ok(
      lagChars <= 200 * TARGET_LAG_S,
      `lag ${lagChars} chars exceeds the target lag`,
    );
  });

  it("snaps very old backlog in instead of trailing far behind", () => {
    const pacer = new StreamingRevealPacer(0);
    pacer.setTarget(MAX_BACKLOG_CHARS * 3);
    const shown = pacer.advance(0);
    assert.equal(shown, MAX_BACKLOG_CHARS * 2);
  });

  it("flushes the remainder quickly once the source is done", () => {
    const pacer = new StreamingRevealPacer(0);
    pacer.setTarget(300, { done: true });
    run(pacer, DONE_FLUSH_S * 1000 + 2 * FRAME_MS);
    assert.equal(pacer.shownLength, 300);
  });

  it("eases into a burst instead of jumping to the catch-up speed", () => {
    const pacer = new StreamingRevealPacer(0);
    pacer.setTarget(5);
    run(pacer, 500);
    pacer.setTarget(400);
    const before = pacer.shownLength;
    const first = pacer.advance(FRAME_MS) - before;
    // Unsmoothed, the first frame would reveal backlog / lag * frame (~26).
    const unsmoothed = ((400 - before) / TARGET_LAG_S) * (FRAME_MS / 1000);
    assert.ok(first < unsmoothed / 3, `first step ${first} jumped`);
    const steps: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const start = pacer.shownLength;
      steps.push(pacer.advance(FRAME_MS) - start);
    }
    for (let index = 1; index < steps.length; index += 1) {
      assert.ok(steps[index]! - steps[index - 1]! <= 3, "speed jumped");
    }
  });

  it("resets the eased speed on snap", () => {
    const pacer = new StreamingRevealPacer(0);
    pacer.setTarget(1000);
    run(pacer, 400);
    assert.ok(pacer.currentRate > MIN_CPS);
    pacer.snap();
    assert.equal(pacer.currentRate, MIN_CPS);
  });

  it("honours a shorter target lag", () => {
    const lagged = (targetLagS?: number) => {
      const pacer = new StreamingRevealPacer(0, { targetLagS });
      let target = 0;
      for (let burst = 0; burst < 20; burst += 1) {
        target += 40;
        pacer.setTarget(target);
        run(pacer, 200);
      }
      return target - pacer.shownLength;
    };
    assert.ok(lagged(0.12) < lagged());
  });

  it("follows a shrinking target", () => {
    const pacer = new StreamingRevealPacer(50);
    pacer.setTarget(20);
    assert.equal(pacer.shownLength, 20);
    assert.equal(pacer.settled, true);
  });
});

describe("revealBoundary", () => {
  it("never splits a surrogate pair", () => {
    const text = "a😀b";
    assert.equal(revealBoundary(text, 2), 3);
    assert.equal(revealBoundary(text, 1), 1);
    assert.equal(revealBoundary(text, 10), 4);
  });
});
