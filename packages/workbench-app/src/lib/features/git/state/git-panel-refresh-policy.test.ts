import assert from "node:assert/strict";
import { test } from "node:test";
import { joinGitProjectRefresh } from "./git-panel-refresh-policy.js";

test("discovery demand joins an active request and promotes details without demoting later", () => {
  const state = { discoveryRequest: { inFlight: true, loadsDetails: false } };
  assert.equal(joinGitProjectRefresh(state, false), true);
  assert.equal(state.discoveryRequest.loadsDetails, false);
  assert.equal(joinGitProjectRefresh(state, true), true);
  assert.equal(state.discoveryRequest.loadsDetails, true);
  assert.equal(joinGitProjectRefresh(state, false), true);
  assert.equal(state.discoveryRequest.loadsDetails, true);
});

test("idle discovery does not consume or mutate demand", () => {
  const state = { discoveryRequest: { inFlight: false, loadsDetails: false } };
  assert.equal(joinGitProjectRefresh(state, true), false);
  assert.equal(state.discoveryRequest.loadsDetails, false);
});
