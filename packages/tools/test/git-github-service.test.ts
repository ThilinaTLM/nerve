import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrListFilters } from "@nervekit/contracts";
import {
  githubPrListArgs,
  listOpenPrs,
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
