import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrListFilters } from "@nervekit/contracts";
import {
  allowedMergeMethods,
  githubPrListArgs,
  listOpenPrs,
  mergePr,
  prDetail,
  prFiles,
} from "../src/git/git-github-service.js";
import { summarizeStatusCheckRollup } from "../src/git/git-github-parsers.js";

const defaults: GithubPrListFilters = {
  author: "any",
  drafts: "include",
  title: "",
  labels: [],
  sort: "updated-desc",
};

describe("GitHub PR listing", () => {
  it("builds exact server-side filters with a fixed limit", () => {
    const args = githubPrListArgs({
      author: "me",
      drafts: "exclude",
      title: 'fix "Windows" \\ paths',
      head: "feature/git-panel",
      labels: ["bug", "needs review"],
      sort: "updated-asc",
    });
    assert.deepEqual(args.slice(0, 6), [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "10",
    ]);
    assert.ok(args.includes("@me"));
    assert.ok(args.includes("feature/git-panel"));
    assert.equal(args.filter((arg) => arg === "--label").length, 2);
    const search = args[args.indexOf("--search") + 1];
    assert.equal(
      search,
      'sort:updated-asc in:title "fix \\"Windows\\" \\\\ paths" draft:false',
    );
    assert.match(args.at(-1) ?? "", /statusCheckRollup/);
  });

  it("lists PRs and checks with one gh invocation", async () => {
    const calls: string[][] = [];
    const context = {
      resolveRepoDir: () => "/repo",
      ensureGithubRemote: async () => undefined,
      mapGh: async <T>(fn: () => Promise<T>) => fn(),
      runGh: async (_repo: string, args: string[]) => {
        calls.push(args);
        return {
          stderr: "",
          stdout: JSON.stringify([
            {
              number: 7,
              title: "Fast panel",
              url: "https://github.com/example/repo/pull/7",
              state: "OPEN",
              isDraft: false,
              headRefName: "feature",
              baseRefName: "main",
              updatedAt: "2026-07-20T00:00:00Z",
              statusCheckRollup: [
                {
                  __typename: "CheckRun",
                  name: "test",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  detailsUrl: "https://example.test/check",
                },
              ],
            },
          ]),
        };
      },
    };
    const result = await listOpenPrs(
      context as Parameters<typeof listOpenPrs>[0],
      "proj_test",
      ".",
      defaults,
    );
    assert.equal(calls.length, 1);
    assert.equal(result.prs[0]?.checks.status, "passing");
    assert.equal(result.prs[0]?.checks.runs[0]?.name, "test");
  });
});

describe("GitHub PR detail and mutations", () => {
  it("maps conversation, merge settings, checks, and base divergence", async () => {
    const calls: string[][] = [];
    const context = {
      resolveRepoDir: () => "/repo",
      ensureGithubRemote: async () => undefined,
      mapGh: async <T>(fn: () => Promise<T>) => fn(),
      runGh: async (_repo: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "repo") {
          return {
            stderr: "",
            stdout: JSON.stringify({
              nameWithOwner: "example/repo",
              mergeCommitAllowed: false,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
            }),
          };
        }
        if (args[0] === "api") return { stderr: "", stdout: "2\n" };
        if (args[1] === "checks") return { stderr: "", stdout: "[]" };
        return {
          stderr: "",
          stdout: JSON.stringify({
            number: 7,
            title: "Feature rich PR",
            url: "https://github.com/example/repo/pull/7",
            state: "OPEN",
            isDraft: false,
            headRefName: "feature",
            baseRefName: "main",
            headRefOid: "head1234567",
            baseRefOid: "base1234567",
            updatedAt: "2026-07-21T00:00:00Z",
            createdAt: "2026-07-20T00:00:00Z",
            author: { login: "octocat" },
            changedFiles: 1,
            mergeable: "MERGEABLE",
            mergeStateStatus: "BEHIND",
            comments: [
              {
                id: "comment-1",
                author: { login: "reviewer" },
                body: "Looks good",
                createdAt: "2026-07-21T00:00:00Z",
              },
            ],
            reviews: [
              {
                id: "review-1",
                author: { login: "maintainer" },
                state: "APPROVED",
                body: "Approved",
                submittedAt: "2026-07-22T00:00:00Z",
              },
            ],
            labels: [{ name: "enhancement", color: "00ff00" }],
            reviewRequests: [{ login: "next-reviewer" }],
            commits: [],
          }),
        };
      },
    };

    const result = await prDetail(
      context as Parameters<typeof prDetail>[0],
      "proj_test",
      ".",
      7,
    );
    assert.deepEqual(result.mergeSettings.allowedMethods, ["squash", "rebase"]);
    assert.equal(result.behindBy, 2);
    assert.equal(result.comments[0]?.author, "reviewer");
    assert.equal(result.reviews[0]?.state, "APPROVED");
    assert.equal(result.reviewRequests[0]?.login, "next-reviewer");
    assert.ok(
      calls.some((args) => args[0] === "api" && args[1]?.includes("compare")),
    );
  });

  it("maps paginated file patches and rename metadata", async () => {
    const context = {
      resolveRepoDir: () => "/repo",
      ensureGithubRemote: async () => undefined,
      mapGh: async <T>(fn: () => Promise<T>) => fn(),
      runGh: async (_repo: string, args: string[]) => {
        if (args[0] === "pr") return { stderr: "", stdout: "1\n" };
        return {
          stderr: "",
          stdout: JSON.stringify([
            {
              filename: "src/new.ts",
              previous_filename: "src/old.ts",
              status: "renamed",
              additions: 2,
              deletions: 1,
              changes: 3,
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ]),
        };
      },
    };
    const result = await prFiles(
      context as Parameters<typeof prFiles>[0],
      "proj_test",
      ".",
      7,
    );
    assert.equal(result.totalCount, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.files[0]?.previousPath, "src/old.ts");
    assert.equal(result.files[0]?.status, "renamed");
    assert.match(result.files[0]?.patch ?? "", /\+new/);
  });

  it("uses repository-allowed noninteractive merge methods with a head guard", async () => {
    assert.deepEqual(
      allowedMergeMethods({
        mergeCommitAllowed: true,
        squashMergeAllowed: false,
        rebaseMergeAllowed: true,
      }),
      ["merge", "rebase"],
    );
    for (const [method, flag] of [
      ["merge", "--merge"],
      ["squash", "--squash"],
      ["rebase", "--rebase"],
    ] as const) {
      const calls: string[][] = [];
      const context = {
        resolveRepoDir: () => "/repo",
        ensureGithubRemote: async () => undefined,
        invalidateStableMetadata: () => undefined,
        mapGh: async <T>(fn: () => Promise<T>) => fn(),
        runGh: async (_repo: string, args: string[]) => {
          calls.push(args);
          if (args[0] === "repo") {
            return {
              stderr: "",
              stdout: JSON.stringify({
                nameWithOwner: "example/repo",
                mergeCommitAllowed: true,
                squashMergeAllowed: true,
                rebaseMergeAllowed: true,
              }),
            };
          }
          if (args[1] === "view") {
            return {
              stderr: "",
              stdout: "https://github.com/example/repo/pull/7\n",
            };
          }
          return { stderr: "", stdout: "" };
        },
      };
      await mergePr(
        context as Parameters<typeof mergePr>[0],
        "proj_test",
        ".",
        7,
        method,
        "head1234567",
      );
      assert.ok(
        calls.some((args) =>
          args
            .join(" ")
            .includes(`pr merge 7 ${flag} --match-head-commit head1234567`),
        ),
      );
    }
  });
});

describe("status check rollups", () => {
  it("normalizes check runs and status contexts", () => {
    const summary = summarizeStatusCheckRollup([
      {
        __typename: "CheckRun",
        name: "build",
        status: "IN_PROGRESS",
        conclusion: null,
      },
      {
        __typename: "StatusContext",
        context: "lint",
        state: "FAILURE",
        targetUrl: "https://example.test/lint",
      },
      { unexpected: true },
    ]);
    assert.equal(summary.status, "failing");
    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.pending, 1);
  });
});
