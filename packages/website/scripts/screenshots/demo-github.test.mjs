import assert from "node:assert/strict";
import test from "node:test";
import * as git from "../../../contracts/src/domains/git/git.ts";
import * as background from "../../../contracts/src/domains/git/git-background.ts";
import {
  DEMO_GITHUB_METHODS,
  DEMO_GITHUB_PR_NUMBERS,
  demoGithubResult,
  demoGithubResponse,
  demoGithubRepositoryHints,
} from "./demo-github.mjs";

const projectParams = { projectId: "proj_demo", repo: "aurora-api" };

test("synthetic GitHub reads satisfy the current product contracts", () => {
  const detail = { ...projectParams, number: 42 };
  const schemas = {
    "github.status.get": [{}, git.githubStatusResponseSchema],
    "github.pr.snapshot.get": [projectParams, git.githubPrSnapshotSchema],
    "github.pr.refresh": [projectParams, git.githubPrSnapshotSchema],
    "github.pr.watch.sync": [projectParams, git.githubPrWatchStateSchema],
    "github.pr.watch.clear": [projectParams, git.githubPrWatchStateSchema],
    "github.pr.expect": [projectParams, git.githubPrAckSchema],
    "github.pr.list": [projectParams, git.githubPrListResponseSchema],
    "github.pr.cached.list": [
      projectParams,
      background.githubPrCachedListResponseSchema,
    ],
    "github.issue.list": [
      projectParams,
      background.githubIssueListResponseSchema,
    ],
    "github.pr.initial.get": [detail, git.githubPrInitialSchema],
    "github.pr.core.get": [detail, git.githubPrCoreSchema],
    "github.pr.conversation.get": [detail, git.githubPrConversationSchema],
    "github.pr.overview.get": [detail, git.githubPrOverviewSchema],
    "github.pr.checks.get": [detail, git.githubPrChecksResponseSchema],
    "github.pr.commits.get": [detail, git.githubPrCommitsResponseSchema],
    "github.pr.files.get": [detail, git.githubPrFilesResponseSchema],
    "github.pr.file.diff.get": [
      { ...detail, path: "src/middleware/rate-limit.ts" },
      git.githubPrFileDiffResponseSchema,
    ],
  };
  assert.deepEqual(
    Object.keys(schemas).sort(),
    [...DEMO_GITHUB_METHODS].sort(),
  );
  for (const [method, [params, schema]] of Object.entries(schemas))
    schema.parse(demoGithubResult(method, params));
  for (const number of DEMO_GITHUB_PR_NUMBERS)
    git.githubPrInitialSchema.parse(
      demoGithubResult("github.pr.initial.get", { ...projectParams, number }),
    );
});

test("the fixtures cover the PR states the pane renders", () => {
  const { prs } = demoGithubResult("github.pr.snapshot.get", projectParams);
  assert.equal(prs.length, 3);
  assert.ok(prs.some((pr) => pr.author === "aurora-demo" && !pr.isDraft));
  assert.ok(prs.some((pr) => pr.reviewRequested));
  assert.ok(prs.some((pr) => pr.isDraft));
  const checks = prs.find((pr) => pr.number === 42).checks;
  assert.ok(checks.passed > 0 && checks.failed > 0 && checks.pending > 0);
  const { commits } = demoGithubResult("github.pr.commits.get", {
    ...projectParams,
    number: 42,
  });
  assert.ok(new Set(commits.map((c) => c.authoredDate.slice(0, 10))).size >= 3);
});

test("capture proxy answers GitHub reads but never mutations or unrelated traffic", () => {
  const request = {
    protocol: "nerve",
    version: 1,
    kind: "request",
    id: "request",
    ts: "2026-10-20T09:00:00Z",
    source: "client",
    target: "server",
    data: {
      method: "github.pr.initial.get",
      params: { ...projectParams, number: 42 },
    },
  };
  const response = demoGithubResponse(request);
  assert.equal(response.replyTo, request.id);
  assert.equal(response.target, request.source);
  assert.deepEqual(
    response.data.result,
    demoGithubResult(request.data.method, request.data.params),
  );
  for (const method of [
    "github.pr.merge",
    "git.operation.start",
    "conversation.get",
  ])
    assert.equal(
      demoGithubResponse({ ...request, data: { method } }),
      undefined,
    );
  assert.equal(demoGithubResponse({ ...request, kind: "event" }), undefined);
});

test("repository hints modify only the fictional API repository and leave the original untouched", () => {
  const original = {
    repos: [
      {
        isRepo: true,
        name: "aurora-api",
        hasRemote: false,
        hasGithubRemote: false,
      },
      { isRepo: true, name: "other", hasRemote: false },
    ],
  };
  const result = demoGithubRepositoryHints(original);
  assert.equal(result.repos[0].hasGithubRemote, true);
  assert.equal(original.repos[0].hasGithubRemote, false);
  assert.deepEqual(result.repos[1], original.repos[1]);
});
