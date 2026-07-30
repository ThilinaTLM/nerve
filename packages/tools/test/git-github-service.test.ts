import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrListFilters } from "@nervekit/contracts";
import {
  allowedMergeMethods,
  githubPrSearch,
  listOpenPrs,
  mergePr,
  prFiles,
  prInitial,
} from "../src/git/git-github-service.js";
import { summarizeStatusCheckRollup } from "../src/git/git-github-parsers.js";

const repository = {
  hostname: "github.com" as const,
  owner: "example",
  repo: "repo",
  remoteUrl: "git@github.com:example/repo.git",
};
const defaults: GithubPrListFilters = {
  author: "any",
  drafts: "include",
  title: "",
  labels: [],
  sort: "updated-desc",
};

function context(api: {
  graphql?: (operation: string, variables: Record<string, unknown>) => unknown;
  rest?: (
    path: string,
    options: { body?: unknown; method?: string },
  ) => unknown;
}) {
  return {
    resolveRepoDir: () => "/repo",
    ensureGithubRemote: async () => undefined,
    repoRemoteState: async () => ({
      hasRemote: true,
      hasGithubRemote: true,
      githubRepository: repository,
    }),
    githubApi: {
      graphql: async <T>(
        _repository: unknown,
        operation: string,
        _query: string,
        variables: Record<string, unknown>,
      ) => api.graphql?.(operation, variables) as T,
      rest: async <T>(
        _repository: unknown,
        path: string,
        options: { body?: unknown; method?: string },
      ) => api.rest?.(path, options) as T,
    },
    invalidateStableMetadata: () => undefined,
  } as unknown as Parameters<typeof listOpenPrs>[0];
}

describe("GitHub PR listing", () => {
  it("builds exact server-side filters", () => {
    assert.equal(
      githubPrSearch({
        author: "me",
        drafts: "exclude",
        title: 'fix "Windows" \\ paths',
        head: "feature/git-panel",
        labels: ["bug", "needs review"],
        sort: "updated-asc",
      }),
      'is:pr is:open author:@me head:"feature/git-panel" label:"bug" label:"needs review" in:title "fix \\"Windows\\" \\\\ paths" draft:false sort:updated-asc',
    );
  });

  it("lists PRs and check rollups with one GraphQL request", async () => {
    const calls: string[] = [];
    const result = await listOpenPrs(
      context({
        graphql: (operation) => {
          calls.push(operation);
          return {
            search: {
              nodes: [
                {
                  number: 7,
                  title: "Fast panel",
                  url: "https://github.com/example/repo/pull/7",
                  state: "OPEN",
                  isDraft: false,
                  headRefName: "feature",
                  baseRefName: "main",
                  updatedAt: "2026-07-20T00:00:00Z",
                  commits: {
                    nodes: [
                      {
                        commit: {
                          statusCheckRollup: {
                            contexts: {
                              nodes: [
                                {
                                  __typename: "CheckRun",
                                  name: "test",
                                  status: "COMPLETED",
                                  conclusion: "SUCCESS",
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          };
        },
      }),
      "proj_test",
      ".",
      defaults,
    );
    assert.deepEqual(calls, ["list-pull-requests"]);
    assert.equal(result.prs[0]?.checks.status, "passing");
  });
});

describe("GitHub PR details and mutations", () => {
  it("maps one initial GraphQL response and a REST comparison", async () => {
    const operations: string[] = [];
    const result = await prInitial(
      context({
        graphql: (operation) => {
          operations.push(operation);
          return {
            repository: {
              mergeCommitAllowed: false,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
              pullRequest: {
                number: 7,
                title: "Feature rich PR",
                url: "https://github.com/example/repo/pull/7",
                state: "OPEN",
                isDraft: false,
                headRefName: "feature",
                baseRefName: "main",
                headRefOid: "head123",
                baseRefOid: "base123",
                updatedAt: "2026-07-21T00:00:00Z",
                createdAt: "2026-07-20T00:00:00Z",
                author: { login: "octocat" },
                changedFiles: 1,
                body: "Description",
                comments: {
                  nodes: [
                    {
                      id: "comment-1",
                      author: { login: "reviewer" },
                      body: "Looks good",
                      createdAt: "2026-07-21T00:00:00Z",
                    },
                  ],
                },
                reviews: { nodes: [] },
                labels: { nodes: [{ name: "enhancement", color: "00ff00" }] },
                reviewRequests: {
                  nodes: [{ requestedReviewer: { login: "next-reviewer" } }],
                },
                mergeable: "MERGEABLE",
              },
            },
          };
        },
        rest: (path) => {
          assert.match(path, /compare\/base123\.\.\.head123/);
          return { behind_by: 2 };
        },
      }) as Parameters<typeof prInitial>[0],
      "proj_test",
      ".",
      7,
    );
    assert.deepEqual(operations, ["pull-request-initial"]);
    assert.equal(result.core.title, "Feature rich PR");
    assert.equal(result.conversation.comments[0]?.author, "reviewer");
    assert.equal(result.overview.behindBy, 2);
    assert.deepEqual(result.overview.mergeSettings.allowedMethods, [
      "squash",
      "rebase",
    ]);
  });

  it("maps bounded file patches and rename metadata", async () => {
    const result = await prFiles(
      context({
        rest: (path) =>
          path.endsWith("/files?per_page=100&page=1")
            ? [
                {
                  filename: "src/new.ts",
                  previous_filename: "src/old.ts",
                  status: "renamed",
                  additions: 2,
                  deletions: 1,
                  changes: 3,
                  patch: "@@ -1 +1 @@\n-old\n+new",
                },
              ]
            : { changed_files: 1 },
      }) as Parameters<typeof prFiles>[0],
      "proj_test",
      ".",
      7,
    );
    assert.equal(result.totalCount, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.files[0]?.previousPath, "src/old.ts");
    assert.equal(result.files[0]?.status, "renamed");
  });

  it("uses allowed merge methods and sends the expected head SHA", async () => {
    assert.deepEqual(
      allowedMergeMethods({
        mergeCommitAllowed: true,
        squashMergeAllowed: false,
        rebaseMergeAllowed: true,
      }),
      ["merge", "rebase"],
    );
    let body: unknown;
    const result = await mergePr(
      context({
        graphql: () => ({
          repository: {
            mergeCommitAllowed: true,
            squashMergeAllowed: true,
            rebaseMergeAllowed: true,
          },
        }),
        rest: (_path, options) => {
          body = options.body;
          return { merged: true };
        },
      }) as Parameters<typeof mergePr>[0],
      "proj_test",
      ".",
      7,
      "squash",
      "head1234567",
    );
    assert.deepEqual(body, {
      merge_method: "squash",
      sha: "head1234567",
    });
    assert.equal(result.url, "https://github.com/example/repo/pull/7");
  });
});

describe("status check rollups", () => {
  it("normalizes check runs and status contexts", () => {
    const summary = summarizeStatusCheckRollup([
      { name: "build", status: "IN_PROGRESS", conclusion: null },
      { context: "lint", state: "FAILURE", targetUrl: "https://example.test" },
    ]);
    assert.equal(summary.status, "failing");
    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.pending, 1);
  });
});
