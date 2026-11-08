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

void test("the shared budget blocks all callers on a limit, escalates on repeats and spaces cycles", async () => {
  const { GithubRateBudget, githubRepoKey } =
    await import("./pr-sync-policy.js");
  assert.equal(
    githubRepoKey("GitHub.com", "Acme", "Repo"),
    "github.com/acme/repo",
  );
  const budget = new GithubRateBudget(250);
  assert.equal(budget.reserve(1_000), 1_000);
  assert.equal(budget.reserve(1_000), 1_250);
  assert.equal(budget.reserve(1_000), 1_500);
  const first = budget.limited(10_000, new Headers({ "retry-after": "30" }));
  assert.equal(
    first,
    70_000,
    "backoff floor of a minute beats retry-after 30 s",
  );
  assert.equal(budget.blockedUntil(20_000), 70_000);
  assert.equal(budget.reserve(20_000), 70_000, "cycles start after the block");
  const second = budget.limited(70_000, new Headers());
  assert.equal(second, 70_000 + 120_000);
  budget.succeeded();
  const third = budget.limited(200_000, new Headers());
  assert.equal(third, 260_000, "a success resets escalation");
  assert.equal(budget.blockedUntil(300_000), 0);
});

void test("the shared budget turns low near the limit until reset and honors the reset time", async () => {
  const { GithubRateBudget } = await import("./pr-sync-policy.js");
  const budget = new GithubRateBudget();
  budget.observe(
    new Headers({
      "x-ratelimit-remaining": "100",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-reset": "2000",
    }),
  );
  assert.equal(budget.low(1_000_000), true);
  assert.equal(budget.low(2_000_001), false, "reset passed");
  const exhausted = new Headers({
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "500",
  });
  assert.equal(budget.limited(100_000, exhausted), 500_000);
});
