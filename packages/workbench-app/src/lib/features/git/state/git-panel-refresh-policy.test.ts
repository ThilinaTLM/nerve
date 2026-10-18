import assert from "node:assert/strict";
import { test } from "node:test";
import {
  joinGitProjectRefresh,
  joinGitReadRefresh,
  gitAutomaticOverviewOptions,
  consumeGitReadSoftDemand,
  takeGitReadQueuedRefresh,
  createGitOverviewReadGuard,
  gitOverviewReadInvalidation,
} from "./git-panel-refresh-policy.js";

const request = () => ({
  inFlight: true,
  refreshQueued: false,
  queuedUncertain: undefined as boolean | undefined,
});

test("uncertain automatic requests never force supersession; hard/manual requests still do and dominate a queued poll", () => {
  const soft = gitAutomaticOverviewOptions({ uncertain: true });
  assert.equal(soft.force, false);
  assert.equal(soft.uncertain, true);
  assert.equal(gitAutomaticOverviewOptions({}).force, true);
  assert.equal(
    gitOverviewReadInvalidation({ force: true, uncertain: true }, true),
    "hard",
  );
  assert.equal(gitOverviewReadInvalidation({}, true), "soft");
  const state = request();
  for (let poll = 0; poll < 3; poll++)
    assert.equal(joinGitReadRefresh(state, soft), true);
  assert.equal(state.refreshQueued, true);
  assert.equal(state.queuedUncertain, true);
  joinGitReadRefresh(state, { force: true });
  joinGitReadRefresh(state, soft);
  assert.equal(
    state.queuedUncertain,
    false,
    "a poll cannot demote a real/manual refresh",
  );
  state.inFlight = false;
  assert.equal(joinGitReadRefresh(state, soft), false);
});

test("overview read guard preserves known invalidity and invalidations arriving after a real read begins", () => {
  const request = { invalidation: 1 };
  const guard = createGitOverviewReadGuard(request, true);
  assert.equal(guard.isStale({ stale: false }), true);
  guard.begin();
  assert.equal(guard.isStale({ stale: false }), false);
  request.invalidation++;
  assert.equal(guard.isStale({ stale: false }), true);
  guard.expectRead();
  assert.equal(guard.isStale({ stale: false }), true);
  guard.begin();
  assert.equal(guard.isStale({ stale: true }), true);
  assert.equal(guard.isStale({ stale: false }), false);
});

test("discovery demand joins an active request and promotes details without demoting later", () => {
  const state = { discoveryRequest: { ...request(), loadsDetails: false } };
  assert.equal(joinGitProjectRefresh(state, false), true);
  assert.equal(state.discoveryRequest.loadsDetails, false);
  assert.equal(joinGitProjectRefresh(state, true), true);
  assert.equal(state.discoveryRequest.loadsDetails, true);
  assert.equal(joinGitProjectRefresh(state, false), true);
  assert.equal(state.discoveryRequest.loadsDetails, true);
});

test("idle discovery does not consume or mutate demand", () => {
  const state = {
    discoveryRequest: { ...request(), inFlight: false, loadsDetails: false },
  };
  assert.equal(joinGitProjectRefresh(state, true), false);
  assert.equal(state.discoveryRequest.loadsDetails, false);
});

test("one bounded follow-up consumes soft notices but never absorbs a queued explicit hard demand", () => {
  const state = request();
  joinGitReadRefresh(state, { uncertain: true });
  assert.equal(consumeGitReadSoftDemand(state), true);
  assert.equal(state.refreshQueued, false);
  joinGitReadRefresh(state, { force: true });
  assert.equal(consumeGitReadSoftDemand(state), false);
  joinGitReadRefresh(state, { uncertain: true });
  assert.deepEqual(takeGitReadQueuedRefresh(state, true, false), {
    silent: true,
    force: true,
    uncertain: false,
    onlyIfChanged: true,
  });
  assert.equal(state.refreshQueued, false);
  assert.equal(takeGitReadQueuedRefresh(state, true), undefined);
});

test("soft demand during the second read stops; withdrawn demand cannot start idle revalidation", () => {
  const state = request();
  joinGitReadRefresh(state, { uncertain: true });
  assert.equal(takeGitReadQueuedRefresh(state, true), undefined);
  assert.equal(state.refreshQueued, false);
  joinGitReadRefresh(state, { uncertain: true });
  assert.equal(takeGitReadQueuedRefresh(state, false, false), undefined);
  joinGitReadRefresh(state, { uncertain: true });
  assert.deepEqual(takeGitReadQueuedRefresh(state, false, true), {
    silent: true,
    force: false,
    uncertain: true,
    onlyIfChanged: true,
  });
});

test("joined discovery visibility demand remains soft, while a later manual request is retained as hard", () => {
  const state = { discoveryRequest: { ...request(), loadsDetails: false } };
  joinGitProjectRefresh(state, true, { uncertain: true });
  assert.equal(state.discoveryRequest.loadsDetails, true);
  assert.equal(state.discoveryRequest.queuedUncertain, true);
  joinGitProjectRefresh(state, false, { force: true });
  joinGitProjectRefresh(state, false, { uncertain: true });
  assert.equal(consumeGitReadSoftDemand(state.discoveryRequest), false);
  assert.equal(
    takeGitReadQueuedRefresh(state.discoveryRequest, true)?.force,
    true,
  );
});
