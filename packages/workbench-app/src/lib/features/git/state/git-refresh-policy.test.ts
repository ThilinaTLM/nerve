import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFresh } from "./git-refresh-policy";

describe("git refresh policy", () => {
  it("uses strict freshness boundaries", () => {
    assert.equal(isFresh(1_000, 1_999, 1_000), true);
    assert.equal(isFresh(1_000, 2_000, 1_000), false);
    assert.equal(isFresh(undefined, 2_000, 1_000), false);
  });
});
