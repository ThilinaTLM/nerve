import assert from "node:assert/strict";
import { test } from "node:test";
import type { GithubPr, GitRepoSummary } from "@nervekit/contracts/git";
import {
  buildRepoGroups,
  checkedOutElsewhere,
  collapsedSummary,
  filterCounts,
  filterRepoGroups,
  needsAttention,
  prCheckout,
  splitBranchName,
  type BranchStatusContext,
} from "./git-repo-tree.js";

function repo(
  path: string,
  fields: Partial<GitRepoSummary> = {},
): GitRepoSummary {
  return {
    relativePath: path,
    absDir: `/work/${path}`,
    name: path.split("/").at(-1) ?? path,
    isRepo: true,
    currentBranch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    unpublishedCount: null,
    stashCount: 0,
    worktreeGroup: path,
    primaryWorktree: true,
    hasRemote: true,
    hasGithubRemote: true,
    baseBranch: "main",
    onBaseBranch: true,
    mergedToBase: true,
    dirty: false,
    changeCount: 0,
    ...fields,
  } as GitRepoSummary;
}
function pr(status: GithubPr["checks"]["status"], state = "OPEN"): GithubPr {
  return { number: 1, state, checks: { status } } as GithubPr;
}
const context = (
  options: {
    failed?: string[];
    running?: string[];
    prs?: Record<string, GithubPr>;
  } = {},
): BranchStatusContext => ({
  failed: (r) => Boolean(options.failed?.includes(r.relativePath)),
  running: (r) => Boolean(options.running?.includes(r.relativePath)),
  pullRequest: (r) => options.prs?.[r.relativePath],
});
const feature = (path: string, fields: Partial<GitRepoSummary> = {}) =>
  repo(path, {
    currentBranch: "feat/x",
    onBaseBranch: false,
    mergedToBase: false,
    ...fields,
  });

test("needs attention: failure, failing checks, merged, diverged or dirty behind", () => {
  assert.equal(needsAttention(feature("a"), context({ failed: ["a"] })), true);
  assert.equal(
    needsAttention(feature("a"), context({ prs: { a: pr("failing") } })),
    true,
  );
  assert.equal(
    needsAttention(feature("a", { mergedToBase: true }), context()),
    true,
  );
  assert.equal(
    needsAttention(
      feature("a"),
      context({ prs: { a: pr("passing", "MERGED") } }),
    ),
    true,
  );
  assert.equal(
    needsAttention(feature("a", { behind: 2, ahead: 1 }), context()),
    true,
  );
  assert.equal(
    needsAttention(feature("a", { behind: 2, changeCount: 1 }), context()),
    true,
  );
});

test("being only behind, or passing/pending checks, is not attention", () => {
  assert.equal(needsAttention(repo("main", { behind: 6 }), context()), false);
  assert.equal(
    needsAttention(
      feature("a", { behind: 1 }),
      context({ prs: { a: pr("pending") } }),
    ),
    false,
  );
  assert.equal(needsAttention(repo("main"), context()), false);
});

test("collapsed summary: most urgent sync, worst open-PR checks, change total", () => {
  const repos = [
    feature("ahead", { ahead: 2, changeCount: 3 }),
    feature("pub", { hasUpstream: false, unpublishedCount: 1, changeCount: 1 }),
    feature("behind", { behind: 1 }),
    feature("run"),
  ];
  const prs = {
    ahead: pr("passing"),
    behind: pr("failing"),
    run: pr("failing", "MERGED"),
  };
  const summary = collapsedSummary(repos, context({ prs }));
  assert.equal(summary.sync.kind, "behind");
  assert.equal(summary.syncRepo?.relativePath, "behind");
  assert.equal(summary.pullRequest?.checks.status, "failing");
  assert.equal(summary.changes, 4);
  assert.equal(
    collapsedSummary(repos, context({ running: ["run"], prs })).sync.kind,
    "running",
  );
  assert.equal(
    collapsedSummary(repos, context({ failed: ["pub"], running: ["run"], prs }))
      .sync.kind,
    "failed",
  );
  assert.equal(collapsedSummary([repo("clean")], context()).sync.kind, "none");
});

test("branch names keep the start and the last ten characters", () => {
  assert.deepEqual(splitBranchName("main"), { head: "main", tail: "" });
  assert.deepEqual(splitBranchName("hotfix/1.4.2-abc"), {
    head: "hotfix/1.4.2-abc",
    tail: "",
  });
  const long = splitBranchName(
    "feature/NRV-2481-add-oauth-token-refresh-for-mobile-clients",
  );
  assert.equal(long.tail, "e-clients".padStart(10, "l"));
  assert.equal(
    long.head + long.tail,
    "feature/NRV-2481-add-oauth-token-refresh-for-mobile-clients",
  );
});

test("groups: primary first, linked by folder, repositories alphabetical", () => {
  const grouped = (path: string, group: string, primary: boolean) =>
    Object.assign(repo(path), {
      worktreeGroup: group,
      primaryWorktree: primary,
    });
  const groups = buildRepoGroups([
    grouped(".worktrees/zeta", "ui", false),
    grouped("ui", "ui", true),
    grouped("api", "api", true),
    grouped(".worktrees/alpha", "ui", false),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["api", "ui"],
  );
  assert.deepEqual(
    groups[1]!.repos.map((r) => r.relativePath),
    ["ui", ".worktrees/alpha", ".worktrees/zeta"],
  );
  assert.equal(groups[1]!.name, "ui");
});

test("filters and counts; search expands matching branches only", () => {
  const repos = [
    repo("api"),
    feature("ui", { changeCount: 3, dirty: true }),
    feature("worker", { mergedToBase: true }),
  ];
  const groups = buildRepoGroups(repos);
  const ctx = context();
  assert.deepEqual(filterCounts(repos, ctx), {
    all: 3,
    changed: 1,
    attention: 1,
  });
  const names = (f: ReturnType<typeof filterRepoGroups>) =>
    f.map((x) => x.group.name);
  assert.deepEqual(
    names(
      filterRepoGroups(groups, { filter: "changed", search: "", context: ctx }),
    ),
    ["ui"],
  );
  assert.deepEqual(
    names(
      filterRepoGroups(groups, {
        filter: "attention",
        search: "",
        context: ctx,
      }),
    ),
    ["worker"],
  );
  assert.deepEqual(
    names(
      filterRepoGroups(groups, { filter: "all", search: "FEAT", context: ctx }),
    ),
    ["ui", "worker"],
  );
});

test("branches checked out in sibling worktrees are reported by folder", () => {
  const a = repo("api", { worktreeGroup: "g" });
  const b = feature(".wt/api-oauth", {
    worktreeGroup: "g",
    primaryWorktree: false,
  });
  const [group] = buildRepoGroups([a, b]);
  const map = checkedOutElsewhere(group, a);
  assert.equal(map.get("feat/x"), "api-oauth");
  assert.equal(map.has("main"), false);
});

test("without a reference worktree every checked-out branch is reported", () => {
  const a = repo("api", { worktreeGroup: "g" });
  const b = feature(".wt/api-oauth", {
    worktreeGroup: "g",
    primaryWorktree: false,
  });
  const [group] = buildRepoGroups([a, b]);
  const map = checkedOutElsewhere(group);
  assert.equal(map.get("main"), "api");
  assert.equal(map.get("feat/x"), "api-oauth");
  assert.equal(checkedOutElsewhere(undefined).size, 0);
});

test("prCheckout finds the pull request branch in any worktree of the repository", () => {
  const primary = repo(".", { worktreeGroup: "g", currentBranch: "main" });
  const linked = repo(".worktrees/feat", {
    worktreeGroup: "g",
    primaryWorktree: false,
    currentBranch: "feat",
  });
  const other = repo("other", { worktreeGroup: "o", currentBranch: "feat" });
  const all = [primary, linked, other];
  // Opened from the primary; the branch lives in a linked worktree.
  assert.deepEqual(prCheckout(all, ".", "feat"), {
    kind: "linked",
    repo: linked,
  });
  assert.deepEqual(prCheckout(all, ".worktrees/feat", "main"), {
    kind: "primary",
    repo: primary,
  });
  assert.equal(prCheckout(all, ".", "missing"), undefined);
  assert.equal(prCheckout(all, "unknown", "feat"), undefined);
  assert.equal(prCheckout(all, ".", undefined), undefined);
});
