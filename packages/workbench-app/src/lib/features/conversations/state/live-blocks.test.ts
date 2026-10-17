import assert from "node:assert/strict";
import test from "node:test";
import { resetLiveTurnBlocks } from "./live-blocks";

test("assistant reset drops drafts of that turn only", () => {
  const blocks = [
    { turnId: "a", contentIndex: 0, text: "hi" },
    { turnId: "a", contentIndex: 1, toolCall: { name: "bash" } },
    { turnId: "b", contentIndex: 0, text: "other" },
  ];
  assert.deepEqual(resetLiveTurnBlocks(blocks, "a"), [blocks[2]]);
  assert.equal(blocks.length, 3);
});
