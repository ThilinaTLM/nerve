import assert from "node:assert/strict";
import { test } from "node:test";
import { githubPrSchema, type GithubPr } from "@nervekit/contracts/git";
import {
  activeGitPrFilterCount,
  applyGitPrFilterDraft,
  availableGitPrLabels,
  countGitPrsByQuickFilter,
  createGitPrFilterDraft,
  defaultGitPrFilterConfig,
  githubRepositoryKey,
  gitPrFilterConfigsEqual,
  groupGitPrsByRepository,
  groupGithubCheckouts,
  hasActiveGitPrFilters,
  matchesGitPrSearch,
  normalizeGitPrFilterConfig,
  type GitPrListOptions,
  type GitPrRepositorySource,
} from "./pr-filters.js";

const pr = (number: number, patch: Partial<GithubPr> = {}): GithubPr =>
  githubPrSchema.parse({
    number,
    title: "Fix live sync",
    url: `https://github.com/o/r/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    headRefName: `feature-${number}`,
    baseRefName: "main",
    updatedAt: `2026-10-${String(number).padStart(2, "0")}T00:00:00Z`,
    author: "alice",
    labels: [],
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

test("normalizes and bounds unique nonempty labels", () => {
  const normalized = normalizeGitPrFilterConfig({
    ...defaultGitPrFilterConfig,
    labels: [
      " bug ",
      "bug",
      "",
      ...Array.from({ length: 25 }, (_, i) => `label-${i}`),
    ],
  });
  assert.equal(normalized.labels.length, 20);
  assert.deepEqual(normalized.labels.slice(0, 3), [
    "bug",
    "label-0",
    "label-1",
  ]);
});

test("draft round trip, equality and active counts use normalized values", () => {
  const filters = {
    drafts: "only" as const,
    labels: ["bug", "review"],
    sort: "updated-asc" as const,
  };
  const draft = createGitPrFilterDraft(filters);
  assert.equal(draft.labels, "bug, review");
  assert.deepEqual(applyGitPrFilterDraft(draft), filters);
  assert.equal(hasActiveGitPrFilters(defaultGitPrFilterConfig), false);
  assert.equal(
    gitPrFilterConfigsEqual(defaultGitPrFilterConfig, {
      ...defaultGitPrFilterConfig,
      labels: [" "],
    }),
    true,
  );
  assert.equal(activeGitPrFilterCount(filters), 4);
});

test("search matches repository, title, number, author and branch", () => {
  const p = pr(412, {
    title: "Add OAuth refresh",
    author: "Renovate",
    headRefName: "deps/lodash",
  });
  const match = (query: string) => matchesGitPrSearch(query, "api", p);
  assert.equal(match(""), true);
  assert.equal(match("API"), true);
  assert.equal(match("oauth"), true);
  assert.equal(match("412"), true);
  assert.equal(match("#412"), true);
  assert.equal(match("#41"), true);
  assert.equal(match("41"), true);
  assert.equal(match("#12"), false);
  assert.equal(match("renovate"), true);
  assert.equal(match("deps/lod"), true);
  assert.equal(match("api renovate"), true);
  assert.equal(match("api bob"), false);
  assert.equal(match("zzz"), false);
});

test("groups by repository with filters, quick filters and checked-out first", () => {
  const source = (
    key: string,
    prs: GithubPr[],
    checkedOutBranches: string[] = [],
  ): GitPrRepositorySource => ({
    key,
    name: key.split("/")[1]!,
    repository: key,
    prs,
    viewer: "Alice",
    checkedOutBranches: new Set(checkedOutBranches),
  });
  const sources = [
    source("o/web", [pr(1, { author: "bob" })]),
    source(
      "o/api",
      [
        pr(2),
        pr(3, { isDraft: true, reviewRequested: true, labels: ["bug"] }),
        pr(4, { state: "MERGED" }),
        pr(5),
      ],
      ["feature-2"],
    ),
  ];
  const options: GitPrListOptions = {
    query: "",
    quick: "all",
    filters: defaultGitPrFilterConfig,
  };
  const names = (o = options) =>
    groupGitPrsByRepository(sources, o).map(
      (group) => `${group.name}:${group.prs.map((p) => p.number).join(",")}`,
    );
  assert.deepEqual(names(), ["api:2,5,3", "web:1"]);
  assert.deepEqual(names({ ...options, quick: "mine" }), ["api:2,5,3"]);
  assert.deepEqual(names({ ...options, quick: "review" }), ["api:3"]);
  assert.deepEqual(names({ ...options, query: "bob" }), ["web:1"]);
  assert.deepEqual(
    countGitPrsByQuickFilter(sources, defaultGitPrFilterConfig),
    {
      all: 4,
      mine: 3,
      review: 1,
    },
  );
  assert.deepEqual(
    names({
      ...options,
      filters: { ...defaultGitPrFilterConfig, drafts: "exclude" },
    }),
    ["api:2,5", "web:1"],
  );
  assert.deepEqual(
    names({
      ...options,
      filters: {
        ...defaultGitPrFilterConfig,
        labels: ["BUG"],
        sort: "updated-asc",
      },
    }),
    ["api:3"],
  );
  assert.deepEqual(availableGitPrLabels(sources), ["bug"]);
});

test("merges checkouts of one remote and keeps unresolved ones apart", () => {
  assert.deepEqual(githubRepositoryKey("https://github.com/Acme/Api.git"), {
    key: "acme/api",
    name: "Api",
  });
  assert.equal(githubRepositoryKey(null), undefined);
  const groups = groupGithubCheckouts([
    {
      relativePath: "clones/api2",
      currentBranch: "a",
      repositoryUrl: "https://github.com/acme/api",
    },
    {
      relativePath: "api",
      currentBranch: "b",
      repositoryUrl: "https://github.com/acme/api",
    },
    { relativePath: "web", currentBranch: null },
  ]);
  assert.equal(groups.length, 2);
  const api = groups.find((group) => group.key === "acme/api")!;
  assert.equal(api.repository, "api");
  assert.deepEqual(api.members, ["api", "clones/api2"]);
  assert.deepEqual([...api.checkedOutBranches].sort(), ["a", "b"]);
  assert.equal(groups.find((group) => !group.resolved)?.repository, "web");
});
