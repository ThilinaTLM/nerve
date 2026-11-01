import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubPrSchema,
  githubPrSnapshotSchema,
  githubPrCoreSchema,
} from "@nervekit/contracts/git";
import { defaultGitPrFilterConfig as defaults } from "../pr-filters";
import {
  acceptSnapshot,
  mergePrCore,
  filterRepoPrs,
  selectBranchPr,
  mergePrInterests,
  PrWatchDelivery,
} from "./pr-store-model";

const pr = (number: number, patch = {}) =>
  githubPrSchema.parse({
    number,
    title: "Fix live sync",
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    headRefName: "feature",
    baseRefName: "main",
    updatedAt: `2026-10-${number < 10 ? "0" : ""}${number}T00:00:00Z`,
    author: "alice",
    labels: ["Bug"],
    checks: {
      status: "none",
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      runs: [],
    },
    ...patch,
  });

test("local filtering uses the canonical open set and viewer identity", () => {
  const prs = [
    pr(1),
    pr(2, { isDraft: true, reviewRequested: true }),
    pr(3, { author: "bob", headRefName: "other" }),
    pr(4, { state: "MERGED" }),
  ];
  const numbers = (
    filters = defaults,
    viewer: string | null = "ALICE",
    branch = "feature",
  ) => filterRepoPrs(prs, filters, viewer, branch).map((pr) => pr.number);
  assert.deepEqual(numbers(), [3, 2, 1]);
  assert.deepEqual(numbers({ ...defaults, author: "me" }), [2, 1]);
  assert.deepEqual(numbers({ ...defaults, author: "me" }, null), []);
  assert.deepEqual(
    numbers({ ...defaults, author: "username", username: "BOB" }),
    [3],
  );
  assert.deepEqual(
    numbers({
      ...defaults,
      drafts: "exclude",
      currentBranchOnly: true,
      labels: ["bug"],
      title: "LIVE",
    }),
    [1],
  );
  assert.deepEqual(
    numbers({ ...defaults, drafts: "only", reviewRequested: true }),
    [2],
  );
  assert.deepEqual(numbers({ ...defaults, sort: "updated-asc" }), [1, 2, 3]);
});

test("snapshot revision ordering replaces the repository set, including removals", () => {
  const make = (revision: number, prs = [pr(1)]) =>
    githubPrSnapshotSchema.parse({
      projectId: "proj_test",
      repo: ".",
      revision,
      prs,
      status: "fresh",
      updatedAt: null,
      viewer: "alice",
      truncated: false,
    });
  const current = make(4);
  assert.equal(acceptSnapshot(current, make(3)), current);
  assert.deepEqual(acceptSnapshot(current, make(5, [])).prs, []);
  assert.equal(acceptSnapshot(undefined, current), current);
});

test("branch selector retains merged/closed PRs and chooses the latest number", () => {
  const merged = pr(9, { state: "MERGED" });
  assert.equal(
    selectBranchPr(
      [pr(1), merged, pr(10, { headRefName: "other" })],
      "feature",
    ),
    merged,
  );
  assert.equal(selectBranchPr([merged], "missing"), undefined);
  assert.equal(selectBranchPr([merged], undefined), undefined);
});

test("watch interests merge tabs, list, branch and document visibility", () => {
  const base = {
    projectId: "proj_test",
    repo: ".",
    visible: false,
    list: false,
    prs: [2],
  };
  const merged = mergePrInterests(
    [
      base,
      {
        ...base,
        visible: true,
        list: true,
        branch: "feature",
        prs: [2, 3],
        activePr: 3,
      },
    ],
    true,
  );
  assert.deepEqual(merged, {
    ...base,
    visible: true,
    list: true,
    branch: "feature",
    prs: [2, 3],
    activePr: 3,
  });
  assert.equal(mergePrInterests([base], false)?.visible, false);
  assert.equal(mergePrInterests([], true), undefined);
});

test("watch delivery debounces and serializes the latest demand", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const delivery = new PrWatchDelivery(async () => {
    calls++;
  }, 80);
  delivery.schedule();
  delivery.schedule();
  context.mock.timers.tick(79);
  await Promise.resolve();
  assert.equal(calls, 0);
  context.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
});

void test("tab core merges into an entity without reviving stale heads or checks", () => {
  const previous = pr(2, { reviewRequested: true });
  const core = githubPrCoreSchema.parse({
    ...previous,
    title: "New title",
    headRefOid: "new-head",
    baseRefOid: "base",
    createdAt: previous.updatedAt,
    changedFiles: 1,
  });
  const merged = mergePrCore(previous, core);
  assert.equal(merged.title, "New title");
  assert.deepEqual(merged.labels, previous.labels);
  assert.equal(merged.reviewRequested, true);
  assert.equal(merged.headSha, "new-head");
  assert.equal(merged.checks.status, "none");
  assert.equal(
    mergePrCore({ ...previous, updatedAt: "2026-12-01" }, core).title,
    previous.title,
  );
  assert.equal(
    mergePrCore({ ...merged, checks: previous.checks }, core).checks,
    previous.checks,
  );
});
