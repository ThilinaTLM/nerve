import assert from "node:assert/strict";
import { test } from "node:test";
import {
  joinGitProjectRefresh,
  joinGitOverviewRefresh,
  gitAutomaticOverviewOptions,
} from "./git-panel-refresh-policy.js";

test("uncertain automatic requests never force supersession; hard/manual requests still do and dominate a queued poll", () => {
  const soft = gitAutomaticOverviewOptions({ uncertain: true });
  assert.equal(soft.force, false);
  assert.equal(soft.uncertain, true);
  assert.equal(gitAutomaticOverviewOptions({}).force, true);
  const request = {
    inFlight: true,
    refreshQueued: false,
    queuedUncertain: undefined as boolean | undefined,
  };
  for (let poll = 0; poll < 3; poll++)
    assert.equal(joinGitOverviewRefresh(request, soft), true);
  assert.equal(request.refreshQueued, true);
  assert.equal(request.queuedUncertain, true);
  joinGitOverviewRefresh(request, { force: true });
  joinGitOverviewRefresh(request, soft);
  assert.equal(
    request.queuedUncertain,
    false,
    "a poll cannot demote a real/manual refresh",
  );
  request.inFlight = false;
  assert.equal(joinGitOverviewRefresh(request, soft), false);
});

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
