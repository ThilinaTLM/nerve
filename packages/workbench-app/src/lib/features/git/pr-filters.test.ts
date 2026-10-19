import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeGitPrFilterCount,
  applyGitPrFilterDraft,
  applyQuickGitPrFilter,
  createGitPrFilterDraft,
  defaultGitPrFilterConfig,
  gitPrFilterConfigsEqual,
  hasActiveGitPrFilters,
  normalizeGitPrFilterConfig,
  pinCurrentBranchPr,
  quickGitPrFilter,
} from "./pr-filters.js";

test("normalizes filter text and bounds unique nonempty labels", () => {
  const normalized = normalizeGitPrFilterConfig({
    ...defaultGitPrFilterConfig,
    username: " octocat ",
    title: " fix ",
    labels: [
      " bug ",
      "bug",
      "",
      ...Array.from({ length: 25 }, (_, i) => `label-${i}`),
    ],
  });
  assert.equal(normalized.username, "octocat");
  assert.equal(normalized.title, "fix");
  assert.equal(normalized.labels.length, 20);
  assert.deepEqual(normalized.labels.slice(0, 3), [
    "bug",
    "label-0",
    "label-1",
  ]);
});

test("draft round trips preserve policy and gate current branch filtering", () => {
  const filters = {
    ...defaultGitPrFilterConfig,
    currentBranchOnly: true,
    labels: ["bug", "review"],
    sort: "updated-asc" as const,
  };
  const draft = createGitPrFilterDraft(filters);
  assert.equal(draft.labels, "bug, review");
  assert.deepEqual(applyGitPrFilterDraft(draft, true), filters);
  assert.equal(applyGitPrFilterDraft(draft, false).currentBranchOnly, false);
});

test("equality and active filter counts use normalized values", () => {
  assert.equal(hasActiveGitPrFilters(defaultGitPrFilterConfig), false);
  assert.equal(activeGitPrFilterCount(defaultGitPrFilterConfig), 0);
  assert.equal(
    gitPrFilterConfigsEqual(defaultGitPrFilterConfig, {
      ...defaultGitPrFilterConfig,
      title: " ",
      labels: [" "],
    }),
    true,
  );
  const filters = {
    ...defaultGitPrFilterConfig,
    author: "me" as const,
    drafts: "only" as const,
    title: " fix ",
    labels: ["bug", "bug"],
    currentBranchOnly: true,
    sort: "updated-asc" as const,
  };
  assert.equal(activeGitPrFilterCount(filters), 6);
  assert.equal(
    activeGitPrFilterCount({ ...filters, reviewRequested: true }),
    7,
  );
  assert.equal(hasActiveGitPrFilters(filters), true);
});

test("quick filter rewrites only author and review requested", () => {
  const base = {
    ...defaultGitPrFilterConfig,
    title: "fix",
    drafts: "only" as const,
  };
  const mine = applyQuickGitPrFilter(base, "mine");
  assert.equal(mine.author, "me");
  assert.equal(mine.reviewRequested, false);
  assert.equal(mine.title, "fix");
  assert.equal(mine.drafts, "only");
  const review = applyQuickGitPrFilter(mine, "review");
  assert.equal(review.author, "any");
  assert.equal(review.reviewRequested, true);
  assert.equal(applyQuickGitPrFilter(review, "all").reviewRequested, false);
});

test("quick filter is unselected for states outside its presets", () => {
  const c = defaultGitPrFilterConfig;
  assert.equal(quickGitPrFilter(c), "all");
  assert.equal(quickGitPrFilter({ ...c, author: "me" }), "mine");
  assert.equal(quickGitPrFilter({ ...c, reviewRequested: true }), "review");
  assert.equal(
    quickGitPrFilter({ ...c, author: "me", reviewRequested: true }),
    undefined,
  );
  assert.equal(
    quickGitPrFilter({ ...c, author: "username", username: "octocat" }),
    undefined,
  );
});

test("pins the current branch PR first without dropping others", () => {
  const prs = [
    { number: 1, headRefName: "a" },
    { number: 2, headRefName: "b" },
    { number: 3, headRefName: "c" },
  ];
  assert.deepEqual(
    pinCurrentBranchPr(prs, "c").ordered.map((pr) => pr.number),
    [3, 1, 2],
  );
  assert.equal(pinCurrentBranchPr(prs, "x").pinned, undefined);
  assert.deepEqual(pinCurrentBranchPr(prs, null).ordered, prs);
});
