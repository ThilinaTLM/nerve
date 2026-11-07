import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LiveDeltaBuffer,
  applyLiveBatch,
  type LiveBatch,
  type LiveBlockShape,
} from "./live-delta-buffer";

function harness() {
  const callbacks: (() => void)[] = [];
  const cancelled: (() => void)[] = [];
  const commits: LiveBatch[] = [];
  let blocks: LiveBlockShape[] = [];
  const buffer = new LiveDeltaBuffer(
    (batch) => {
      commits.push(batch);
      blocks = applyLiveBatch(blocks, batch.blocks);
    },
    (callback) => {
      callbacks.push(callback);
      return () => {
        cancelled.push(callback);
      };
    },
  );
  const frame = () => {
    const live = callbacks.splice(0).filter((cb) => !cancelled.includes(cb));
    for (const cb of live) cb();
  };
  return { buffer, commits, frame, blocks: () => blocks };
}

test("many deltas commit once per frame with their concatenated text", () => {
  const h = harness();
  for (const part of ["a", "b", "c"]) h.buffer.text("t", 0, part);
  h.buffer.thinking("t", 1, "hm");
  h.buffer.progress("tool", "x");
  h.buffer.progress("tool", "y");
  assert.equal(h.commits.length, 0);
  h.frame();
  assert.equal(h.commits.length, 1);
  assert.deepEqual(
    h.blocks().map((b) => [b.contentIndex, b.text, b.thinking]),
    [
      [0, "abc", ""],
      [1, "", "hm"],
    ],
  );
  assert.deepEqual(h.commits[0].toolOutput, { tool: "xy" });
  h.frame();
  assert.equal(h.commits.length, 1, "nothing pending, nothing committed");
});

test("later frames append without duplicating and keep untouched block identity", () => {
  const h = harness();
  h.buffer.text("t", 0, "one ");
  h.buffer.text("t", 1, "other");
  h.frame();
  const [first, second] = h.blocks();
  h.buffer.text("t", 0, "two");
  h.frame();
  assert.equal(h.blocks()[0].text, "one two");
  assert.notEqual(h.blocks()[0], first);
  assert.equal(h.blocks()[1], second);
});

test("dropTurn discards only that turn's pending deltas and never re-applies them", () => {
  const h = harness();
  h.buffer.text("done", 0, "stale");
  h.buffer.text("live", 0, "keep");
  h.buffer.dropTurn("done");
  h.frame();
  h.frame();
  assert.deepEqual(
    h.blocks().map((b) => [b.turnId, b.text]),
    [["live", "keep"]],
  );
});

test("dropping the last pending delta cancels the scheduled frame", () => {
  const h = harness();
  h.buffer.text("t", 0, "x");
  h.buffer.dropTurn("t");
  h.frame();
  assert.equal(h.commits.length, 0);
});

test("clear and dispose drop pending work; disposed buffers ignore new deltas", () => {
  const h = harness();
  h.buffer.text("t", 0, "x");
  h.buffer.progress("tool", "y");
  h.buffer.clear();
  h.frame();
  assert.equal(h.commits.length, 0);
  h.buffer.text("t", 0, "after clear");
  h.buffer.dispose();
  h.frame();
  h.buffer.text("t", 0, "after dispose");
  h.frame();
  assert.equal(h.commits.length, 0);
});

test("dropToolOutput removes pending progress for one call only", () => {
  const h = harness();
  h.buffer.progress("a", "1");
  h.buffer.progress("b", "2");
  h.buffer.dropToolOutput("a");
  h.frame();
  assert.deepEqual(h.commits[0].toolOutput, { b: "2" });
});

test("flush commits synchronously and later frames add nothing", () => {
  const h = harness();
  h.buffer.text("t", 0, "x");
  h.buffer.flush();
  assert.equal(h.blocks()[0].text, "x");
  h.frame();
  assert.equal(h.commits.length, 1);
});

test("tool call drafts keep the latest cumulative arguments", () => {
  const h = harness();
  h.buffer.toolCall("t", 0, {
    providerCallId: "p",
    name: "bash",
    partialArgsText: "{",
  });
  h.buffer.toolCall("t", 0, {
    providerCallId: "p",
    name: "bash",
    partialArgsText: "{}",
  });
  h.frame();
  assert.equal(h.blocks()[0].toolCall?.partialArgsText, "{}");
});
