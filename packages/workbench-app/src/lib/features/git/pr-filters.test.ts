import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeGitPrFilterCount,
  applyGitPrFilterDraft,
  createGitPrFilterDraft,
  defaultGitPrFilterConfig,
  gitPrFilterConfigsEqual,
  hasActiveGitPrFilters,
  normalizeGitPrFilterConfig,
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
  assert.equal(hasActiveGitPrFilters(filters), true);
});
