import assert from "node:assert/strict";
import test from "node:test";
import { branchStatusLine, branchSubtitle } from "./mobile-git-summary";

const base = {
  detached: false,
  hasUpstream: true,
  hasRemote: true,
  ahead: 0,
  behind: 0,
  unpublishedCount: null,
};

test("branch status describes upstream relation", () => {
  assert.equal(branchStatusLine(base), "Up to date");
  assert.equal(
    branchStatusLine({ ...base, ahead: 2, behind: 1 }),
    "2 ahead · 1 behind",
  );
  assert.equal(
    branchStatusLine({ ...base, hasUpstream: false, unpublishedCount: 3 }),
    "3 unpublished commits · not pushed",
  );
  assert.equal(branchStatusLine({ ...base, hasUpstream: false }), "Not pushed");
  assert.equal(
    branchStatusLine({ ...base, hasUpstream: false, hasRemote: false }),
    "No remote",
  );
  assert.equal(branchStatusLine({ ...base, detached: true }), "Detached HEAD");
});

test("branch subtitle keeps compact arrows", () => {
  assert.equal(
    branchSubtitle({ ...base, currentBranch: "main", ahead: 1, behind: 2 }),
    "main · ↑1 ↓2",
  );
  assert.equal(branchSubtitle(undefined), undefined);
});
