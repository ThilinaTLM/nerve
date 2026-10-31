import assert from "node:assert/strict";
import { test } from "node:test";
import { GithubApiClient } from "../../src/git/git-github-api-client.js";
import type { GithubServiceContext } from "../../src/git/git-github-service.js";
import { fetchPrSummaries } from "../../src/git/git-github-sync.js";

const repository = {
  hostname: "github.com" as const,
  owner: "example",
  repo: "repo",
  remoteUrl: "git@github.com:example/repo.git",
};
const pr = (number: number, state = "OPEN") => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/example/repo/pull/${number}`,
  state,
  isDraft: false,
  headRefName: `feature-${number}`,
  baseRefName: "main",
  headRefOid: `sha-${number}`,
  headRepository: { nameWithOwner: "fork/repo" },
  updatedAt: "2026-11-01T00:00:00Z",
  labels: { nodes: [{ name: "bug", color: "ffffff" }] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "viewer" } }] },
});

function fixture(response: Record<string, unknown>) {
  const requests: Array<{ query: string; variables: unknown }> = [];
  const api = new GithubApiClient({
    tokenProvider: async () => "synthetic-test-token",
    fetch: async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({ data: response }));
    },
  });
  const context = {
    resolveRepoDir: () => "/synthetic/repo",
    ensureGithubRemote: async () => undefined,
    repoRemoteState: async () => ({
      hasRemote: true,
      hasGithubRemote: true,
      githubRepository: repository,
    }),
    githubApi: api,
  } as GithubServiceContext;
  return { api, context, requests };
}

void test("snapshot summary fetch reports truncation and maps head, label and viewer interests", async () => {
  const f = fixture({
    viewer: { login: "viewer" },
    repository: {
      pullRequests: {
        totalCount: 101,
        nodes: [
          pr(7),
          {
            ...pr(8),
            reviewRequests: {
              nodes: [{ requestedReviewer: { login: "someone-else" } }],
            },
          },
        ],
      },
    },
  });
  try {
    const result = await fetchPrSummaries(f.context, "proj_test", ".");
    assert.equal(result.truncated, true);
    assert.equal(result.viewer, "viewer");
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].query, /pullRequests\(states: OPEN, first: 100/);
    assert.deepEqual(f.requests[0].variables, {
      owner: "example",
      repo: "repo",
    });
    assert.equal(result.prs[0].headSha, "sha-7");
    assert.equal(result.prs[0].headRepository, "fork/repo");
    assert.deepEqual(result.prs[0].labels, ["bug"]);
    assert.equal(result.prs[0].reviewRequested, true);
    assert.equal(result.prs[1].reviewRequested, false);
  } finally {
    await f.api.close();
  }
});

void test("specific summaries and the latest branch PR share one batch, including merged PRs and missing numbers", async () => {
  const f = fixture({
    viewer: { login: "viewer" },
    repository: {
      pr7: pr(7),
      pr8: pr(8, "MERGED"),
      pr9: null,
      branch0: { nodes: [pr(10, "CLOSED")] },
    },
  });
  const branch = 'feature/"quoted"';
  try {
    const result = await fetchPrSummaries(
      f.context,
      "proj_test",
      ".",
      [7, 8, 9],
      [branch],
    );
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].query, /pr7: pullRequest\(number: 7\)/);
    assert.match(f.requests[0].query, /pr8: pullRequest\(number: 8\)/);
    assert.ok(
      f.requests[0].query.includes(
        `headRefName: ${JSON.stringify(branch)}, first: 1`,
      ),
    );
    assert.deepEqual(
      result.prs.map((pr) => [pr.number, pr.state]),
      [
        [7, "OPEN"],
        [8, "MERGED"],
        [10, "CLOSED"],
      ],
    );
    assert.equal(result.truncated, false);
  } finally {
    await f.api.close();
  }
});
