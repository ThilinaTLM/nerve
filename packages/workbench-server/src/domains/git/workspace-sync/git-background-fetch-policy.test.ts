import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACKGROUND_FETCH_BACKOFF_CAP_MS,
  BACKGROUND_FETCH_BUSY_RETRY_MS,
  BACKGROUND_FETCH_MAX_MS,
  BACKGROUND_FETCH_MIN_MS,
  afterBusy,
  afterFailure,
  afterSuccess,
  fetchBackoff,
  fetchInterval,
  groupRepresentatives,
  initialFetchDelay,
  nextFetch,
  reconcileGroups,
  type FetchCandidate,
  type FetchGroupState,
} from "./git-background-fetch-policy.js";

const candidate = (
  group: string,
  repo: string,
  primary = false,
  projectId = "p",
): FetchCandidate => ({ projectId, repo, group, primary });

void test("cadence stays within 5-10 minutes and the first fetch is staggered inside the minimum interval", () => {
  assert.equal(fetchInterval(0), BACKGROUND_FETCH_MIN_MS);
  assert.ok(fetchInterval(0.999999) < BACKGROUND_FETCH_MAX_MS);
  assert.equal(fetchInterval(Number.NaN), BACKGROUND_FETCH_MIN_MS);
  assert.equal(initialFetchDelay(0.5), BACKGROUND_FETCH_MIN_MS / 2);
  assert.ok(initialFetchDelay(5) < BACKGROUND_FETCH_MIN_MS);
});

void test("failures back off exponentially up to a cap and success resets", () => {
  const first = fetchBackoff(1, 0);
  assert.equal(first, 2 * BACKGROUND_FETCH_MIN_MS);
  assert.equal(fetchBackoff(2, 0), 4 * BACKGROUND_FETCH_MIN_MS);
  assert.equal(fetchBackoff(50, 0.9), BACKGROUND_FETCH_BACKOFF_CAP_MS);
  const failed = afterFailure({ nextAt: 0, failures: 1 }, 1_000, 0);
  assert.deepEqual(failed, {
    nextAt: 1_000 + 4 * BACKGROUND_FETCH_MIN_MS,
    failures: 2,
  });
  assert.equal(afterSuccess(1_000, 0).failures, 0);
});

void test("a busy repository is retried soon without counting as a failure", () => {
  assert.deepEqual(afterBusy({ nextAt: 0, failures: 2 }, 5_000), {
    nextAt: 5_000 + BACKGROUND_FETCH_BUSY_RETRY_MS,
    failures: 2,
  });
});

void test("one representative per worktree group, preferring the primary worktree", () => {
  const picked = groupRepresentatives([
    candidate("g1", "wt-b"),
    candidate("g1", "wt-a"),
    candidate("g1", "main", true),
    candidate("g2", "other", false, "q"),
    candidate("g2", "other", false, "p"),
  ]);
  assert.deepEqual(
    [...picked].map(([group, c]) => [group, c.projectId, c.repo]),
    [
      ["g1", "p", "main"],
      ["g2", "p", "other"],
    ],
  );
});

void test("new groups are staggered, vanished groups dropped and existing ones kept", () => {
  const states = new Map<string, FetchGroupState>([
    ["old", { nextAt: 1, failures: 0 }],
    ["kept", { nextAt: 7, failures: 3 }],
  ]);
  reconcileGroups(states, new Set(["kept", "new"]), 1_000, () => 0.5);
  assert.deepEqual([...states.keys()].sort(), ["kept", "new"]);
  assert.equal(states.get("kept")?.nextAt, 7);
  assert.equal(states.get("new")?.nextAt, 1_000 + BACKGROUND_FETCH_MIN_MS / 2);
});

void test("the earliest due group runs first; the daemon-wide gap defers all", () => {
  const states = new Map<string, FetchGroupState>([
    ["late", { nextAt: 900, failures: 0 }],
    ["early", { nextAt: 100, failures: 0 }],
    ["future", { nextAt: 5_000, failures: 0 }],
  ]);
  assert.deepEqual(nextFetch({ states, now: 1_000, notBefore: 0 }), {
    group: "early",
  });
  assert.deepEqual(nextFetch({ states, now: 1_000, notBefore: 2_000 }), {
    wakeAt: 2_000,
  });
  assert.equal(nextFetch({ states: new Map(), now: 0, notBefore: 0 }), null);
  states.delete("early");
  states.delete("late");
  assert.deepEqual(nextFetch({ states, now: 1_000, notBefore: 0 }), {
    wakeAt: 5_000,
  });
});
