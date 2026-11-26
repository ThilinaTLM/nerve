import assert from "node:assert/strict";
import { test } from "node:test";
import { highestLevel } from "./attention-island";

test("the highest level waiting sets the compact bell's tone", () => {
  assert.equal(highestLevel({ trust: 2, conversations: 3 }), "trust");
  assert.equal(highestLevel({ trust: 0, conversations: 3 }), "conversation");
  assert.equal(highestLevel({ trust: 0, conversations: 0 }), undefined);
});
