import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrListFilters } from "@nervekit/contracts";
import {
  allowedMergeMethods,
  checkoutPr,
  githubPrSearch,
  listOpenPrs,
  mergePr,
  prFileDiff,
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
    mapGit: async <T>(fn: () => Promise<T>) => fn(),
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

  it("maps bounded file metadata without patch payloads", async () => {
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
    assert.deepEqual(result.files[0], {
      path: "src/new.ts",
      previousPath: "src/old.ts",
      status: "renamed",
      additions: 2,
      deletions: 1,
      changes: 3,
    });
  });

  it("loads complete renamed documents with one GraphQL request", async () => {
    let variables: Record<string, unknown> | undefined;
    const result = await prFileDiff(
      context({
        graphql: (operation, input) => {
          assert.equal(operation, "pull-request-file-diff");
          variables = input;
          return {
            repository: {
              pullRequest: {
                baseRefOid: "base1234",
                headRefOid: "head1234",
                headRepository: { nameWithOwner: "contributor/fork" },
              },
              original: { byteSize: 7, isBinary: false, text: "before\n" },
            },
            headRepository: {
              modified: { byteSize: 6, isBinary: false, text: "after\n" },
            },
          };
        },
      }) as Parameters<typeof prFileDiff>[0],
      "proj_test",
      ".",
      7,
      {
        path: "src/new.ts",
        previousPath: "src/old name.ts",
        status: "renamed",
        expectedBaseRefOid: "base1234",
        expectedHeadRefOid: "head1234",
        expectedHeadRepository: "contributor/fork",
      },
    );

    assert.deepEqual(result, {
      kind: "text",
      path: "src/new.ts",
      previousPath: "src/old name.ts",
      baseRefOid: "base1234",
      headRefOid: "head1234",
      original: "before\n",
      modified: "after\n",
    });
    assert.equal(variables?.originalExpression, "base1234:src/old name.ts");
    assert.equal(variables?.modifiedExpression, "head1234:src/new.ts");
    assert.equal(variables?.headOwner, "contributor");
    assert.equal(variables?.headRepo, "fork");
  });

  it("classifies binary PR file content", async () => {
    const result = await prFileDiff(
      context({
        graphql: () => ({
          repository: {
            pullRequest: {
              baseRefOid: "base1234",
              headRefOid: "head1234",
              headRepository: { nameWithOwner: "example/repo" },
            },
            original: { byteSize: 3, isBinary: true, text: null },
          },
          headRepository: {
            modified: { byteSize: 3, isBinary: true, text: null },
          },
        }),
      }) as Parameters<typeof prFileDiff>[0],
      "proj_test",
      ".",
      7,
      {
        path: "image.bin",
        status: "modified",
        expectedBaseRefOid: "base1234",
        expectedHeadRefOid: "head1234",
        expectedHeadRepository: "example/repo",
      },
    );
    assert.equal(result.kind, "binary");
  });

  it("rejects stale pull request refs", async () => {
    await assert.rejects(
      () =>
        prFileDiff(
          context({
            graphql: () => ({
              repository: {
                pullRequest: {
                  baseRefOid: "newbase1",
                  headRefOid: "newhead1",
                  headRepository: { nameWithOwner: "example/repo" },
                },
              },
              headRepository: {},
            }),
          }) as Parameters<typeof prFileDiff>[0],
          "proj_test",
          ".",
          7,
          {
            path: "file.ts",
            status: "modified",
            expectedBaseRefOid: "oldbase1",
            expectedHeadRefOid: "oldhead1",
            expectedHeadRepository: "example/repo",
          },
        ),
      /Refresh it before loading this file/,
    );
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

describe("GitHub PR checkout", () => {
  const snapshot = {
    headOid: "base",
    branch: {
      head: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
    },
    refs: [],
    remotes: [
      {
        name: "origin",
        fetchUrl: "git@github.com:example/repo.git",
      },
    ],
    files: [],
    recentCommits: [],
    stashes: [],
  };

  it("fetches the pull ref and preserves the GitHub source branch name", async () => {
    const commands: string[][] = [];
    const result = await checkoutPr(
      {
        ...context({
          graphql: () => ({
            repository: {
              pullRequest: {
                headRefName: "feature/source-name",
                headRefOid: "abc123",
              },
            },
          }),
        }),
        readSnapshot: async () => snapshot,
        runGit: async (_repoDir: string, args: string[]) => {
          commands.push(args);
          return { stdout: "", stderr: "" };
        },
        resolveRevision: async () => "abc123",
        isAncestor: async () => false,
        summarizeRepo: async () => ({ currentBranch: "feature/source-name" }),
        repoName: () => "repo",
      } as unknown as Parameters<typeof checkoutPr>[0],
      "project",
      ".",
      42,
    );

    assert.equal(result.number, 42);
    assert.deepEqual(commands, [
      [
        "fetch",
        "--no-tags",
        "origin",
        "+refs/pull/42/head:refs/remotes/origin/pull/42",
      ],
      ["switch", "-c", "feature/source-name", "refs/remotes/origin/pull/42"],
    ]);
  });

  it("prefers a matching fork remote ref while fetching through the base pull ref", async () => {
    const commands: string[][] = [];
    const forkSnapshot = {
      ...snapshot,
      remotes: [
        ...snapshot.remotes,
        {
          name: "contributor",
          fetchUrl: "git@github.com:contributor/repo.git",
        },
      ],
      refs: [
        {
          name: "refs/remotes/contributor/feature",
          target: "fork-head",
        },
      ],
    };
    await checkoutPr(
      {
        ...context({
          graphql: () => ({
            repository: {
              pullRequest: {
                headRefName: "feature",
                headRefOid: "fork-head",
                headRepository: { nameWithOwner: "contributor/repo" },
              },
            },
          }),
        }),
        readSnapshot: async () => forkSnapshot,
        runGit: async (_repoDir: string, args: string[]) => {
          commands.push(args);
          return { stdout: "", stderr: "" };
        },
        resolveRevision: async () => "fork-head",
        isAncestor: async () => false,
        summarizeRepo: async () => ({ currentBranch: "feature" }),
        repoName: () => "repo",
      } as unknown as Parameters<typeof checkoutPr>[0],
      "project",
      ".",
      12,
    );

    assert.deepEqual(commands[0], [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/pull/12/head:refs/remotes/origin/pull/12",
    ]);
    assert.deepEqual(commands[1], [
      "switch",
      "-c",
      "feature",
      "refs/remotes/contributor/feature",
    ]);
  });

  it("rejects an existing divergent source branch without resetting it", async () => {
    const commands: string[][] = [];
    await assert.rejects(
      checkoutPr(
        {
          ...context({
            graphql: () => ({
              repository: {
                pullRequest: {
                  headRefName: "feature",
                  headRefOid: "new-head",
                },
              },
            }),
          }),
          readSnapshot: async () => ({
            ...snapshot,
            refs: [{ name: "refs/heads/feature", target: "local-head" }],
          }),
          runGit: async (_repoDir: string, args: string[]) => {
            commands.push(args);
            return { stdout: "", stderr: "" };
          },
          resolveRevision: async () => "new-head",
          isAncestor: async () => false,
          summarizeRepo: async () => ({ currentBranch: "feature" }),
          repoName: () => "repo",
        } as unknown as Parameters<typeof checkoutPr>[0],
        "project",
        ".",
        7,
      ),
      /diverged/,
    );
    assert.deepEqual(commands, [
      [
        "fetch",
        "--no-tags",
        "origin",
        "+refs/pull/7/head:refs/remotes/origin/pull/7",
      ],
    ]);
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
