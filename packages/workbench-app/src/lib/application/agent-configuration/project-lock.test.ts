import assert from "node:assert/strict";
import { test } from "node:test";
import { isProjectLocked } from "./project-lock.js";

test("only an untrusted project file locks its column", () => {
  assert.equal(isProjectLocked(undefined), false);
  assert.equal(isProjectLocked({ status: "unavailable" }), false);
  assert.equal(isProjectLocked({ trustState: null }), false);
  assert.equal(isProjectLocked({ trustState: "trusted" }), false);
  assert.equal(isProjectLocked({ trustState: "needs_review" }), true);
  assert.equal(isProjectLocked({ trustState: "declined" }), true);
});
