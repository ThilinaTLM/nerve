import assert from "node:assert/strict";
import test from "node:test";
import * as git from "../../../contracts/src/domains/git/git.ts";
import {
  DEMO_GITHUB_RESULTS,
  demoGithubResponse,
  demoGithubRepositoryHints,
} from "./demo-github.mjs";

test("synthetic GitHub reads satisfy the current product contracts", () => {
  const schemas = {
    "github.status.get": git.githubStatusResponseSchema,
    "github.pr.heads.list": git.githubPrHeadsResponseSchema,
    "github.pr.list": git.githubPrListResponseSchema,
    "github.pr.initial.get": git.githubPrInitialSchema,
    "github.pr.core.get": git.githubPrCoreSchema,
    "github.pr.conversation.get": git.githubPrConversationSchema,
    "github.pr.overview.get": git.githubPrOverviewSchema,
    "github.pr.checks.get": git.githubPrChecksResponseSchema,
    "github.pr.commits.get": git.githubPrCommitsResponseSchema,
    "github.pr.files.get": git.githubPrFilesResponseSchema,
  };
  for (const [method, schema] of Object.entries(schemas))
    schema.parse(DEMO_GITHUB_RESULTS[method]);
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
    data: { method: "github.pr.initial.get" },
  };
  const response = demoGithubResponse(request);
  assert.equal(response.replyTo, request.id);
  assert.equal(response.target, request.source);
  assert.deepEqual(
    response.data.result,
    DEMO_GITHUB_RESULTS[request.data.method],
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
