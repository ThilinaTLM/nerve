import assert from "node:assert/strict";
import { test } from "node:test";
import { githubPrSchema } from "@nervekit/contracts/git";
import {
  PrWatchRegistry,
  diffPrs,
  nextPrProbe,
  rateLimitBackoff,
  retainPrs,
} from "./pr-sync-policy.js";

const pr = (number: number, state = "OPEN", headRefName = "feature") =>
  githubPrSchema.parse({
    number,
    title: "PR",
    url: "https://github.com/a/b/pull/1",
    state,
    isDraft: false,
    headRefName,
    baseRefName: "main",
    updatedAt: `2026-11-0${number}T00:00:00Z`,
    checks: {
      status: "pending",
      total: 1,
      passed: 0,
      failed: 0,
      pending: 1,
      runs: [],
    },
  });
const demand = { visible: true, list: false, prs: [1] };

void test("cadence tiers merge visible demand and signals respect backoff", () => {
  const base = { now: 100_000, lastProbe: 100_000, demands: [], prs: [pr(1)] };
  assert.equal(nextPrProbe(base).repoAt, null);
  assert.equal(
    nextPrProbe({ ...base, demands: [{ ...demand, prs: [] }] }).repoAt,
    160_000,
  );
  assert.equal(nextPrProbe({ ...base, demands: [demand] }).repoAt, 130_000);
  assert.equal(
    nextPrProbe({ ...base, awaitingSince: 100_000 }).repoAt,
    110_000,
  );
  assert.equal(nextPrProbe({ ...base, awaitingSince: 0 }).repoAt, 130_000);
  assert.equal(
    nextPrProbe({ ...base, signalAt: 100_000, backoffUntil: 200_000 }).repoAt,
    200_000,
  );
  assert.equal(
    nextPrProbe({ ...base, demands: [demand], remaining: 10, limit: 100 })
      .checksInterval,
    40_000,
  );
  assert.equal(
    nextPrProbe({ ...base, demands: [demand], pollIntervalMs: 90_000 }).repoAt,
    190_000,
  );
});

void test("rate limits back off exponentially and respect retry/reset", () => {
  assert.equal(rateLimitBackoff(0, 0, new Headers()), 60_000);
  assert.equal(rateLimitBackoff(0, 2, new Headers()), 240_000);
  assert.equal(
    rateLimitBackoff(0, 0, new Headers({ "retry-after": "120" })),
    120_000,
  );
  assert.equal(
    rateLimitBackoff(
      0,
      0,
      new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "300" }),
    ),
    300_000,
  );
});

void test("registry replaces connection demand and releases disconnected owners", () => {
  const registry = new PrWatchRegistry();
  registry.sync("a", "repo", demand);
  registry.sync("b", "repo", demand);
  registry.sync("a", "repo", { ...demand, visible: false });
  assert.equal(registry.demands("repo").length, 2);
  registry.clear("a");
  assert.deepEqual(registry.demands("repo"), [demand]);
  registry.clear("b", "repo");
  assert.equal(registry.owners.size, 0);
});

void test("retention keeps open PRs, tabs, and only the latest PR for each current branch", () => {
  const prs = [pr(1, "CLOSED"), pr(2, "MERGED"), pr(3, "OPEN", "other")];
  assert.deepEqual(
    retainPrs(prs, [{ ...demand, prs: [], branch: "feature" }]).map(
      (pr) => pr.number,
    ),
    [3, 2],
  );
  assert.deepEqual(
    retainPrs(prs, [demand]).map((pr) => pr.number),
    [3, 1],
  );
  assert.deepEqual(
    retainPrs(prs, []).map((pr) => pr.number),
    [3],
  );
  assert.deepEqual(diffPrs(prs, prs), {
    changed: [],
    removed: [],
    checksChanged: [],
  });
  assert.deepEqual(diffPrs(prs, [prs[0]]).removed, [2, 3]);
});

void test("the canonical open set stays bounded while prioritizing watched PRs", () => {
  const prs = Array.from({ length: 110 }, (_, index) => ({
    ...pr(1),
    number: index + 1,
  }));
  const retained = retainPrs(prs, [{ ...demand, prs: [110] }]);
  assert.equal(retained.length, 100);
  assert.equal(
    retained.some((pr) => pr.number === 110),
    true,
  );
});
