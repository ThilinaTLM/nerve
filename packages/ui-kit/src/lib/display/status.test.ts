import assert from "node:assert/strict";
import test from "node:test";
import { agentActivityTone, agentRunningTone } from "./status.js";

test("running profile tones support built-in and custom profiles", () => {
  assert.equal(agentRunningTone("planning"), "success");
  for (const profile of ["coding", "review", undefined]) {
    assert.equal(agentRunningTone(profile), "info");
    assert.equal(agentActivityTone("running", false, profile), "info");
  }
  assert.equal(agentActivityTone("running", false, "planning"), "success");
  assert.equal(agentActivityTone("idle", true, "planning"), "success");
});

test("user gates and idle activity take precedence over profile", () => {
  assert.equal(agentActivityTone("awaiting_user", true, "planning"), "warning");
  assert.equal(agentActivityTone("completed", false, "planning"), "neutral");
});
