import assert from "node:assert/strict";
import { test } from "node:test";
import { gitEventDefinitions } from "../src/domains/git/events.js";
import {
  gitOperationStartRequestSchema,
  gitOperationBulkStartRequestSchema,
  githubCachedListRequestSchema,
  githubIssueListResponseSchema,
  githubPrCachedListResponseSchema,
} from "../src/domains/git/git-background.js";

void test("Git invalidation uncertainty is explicit and never replaces generation or full-refresh requirements", () => {
  const schema = gitEventDefinitions.find(
    (event) => event.name === "git.repository.invalidated",
  )!.payloadSchema;
  const hard = {
    projectId: "proj_test",
    repo: ".",
    generation: 2,
    fullRefreshRequired: true,
  };
  assert.deepEqual(schema.parse(hard), hard);
  assert.deepEqual(schema.parse({ ...hard, refreshCause: "uncertain_poll" }), {
    ...hard,
    refreshCause: "uncertain_poll",
  });
  assert.throws(() => schema.parse({ ...hard, refreshCause: "filesystem" }));
  assert.throws(() =>
    schema.parse({
      ...hard,
      generation: undefined,
      refreshCause: "uncertain_poll",
    }),
  );
  assert.throws(() =>
    schema.parse({
      ...hard,
      fullRefreshRequired: undefined,
      refreshCause: "uncertain_poll",
    }),
  );
});

void test("background starts enforce kind-specific inputs without rewriting clone remotes", () => {
  const scope = { projectId: "proj_test" };
  assert.equal(
    gitOperationStartRequestSchema.parse({ ...scope, kind: "fetch" }).repo,
    ".",
  );
  for (const number of [undefined, 0, -1, 1.5]) {
    assert.equal(
      gitOperationStartRequestSchema.safeParse({
        ...scope,
        kind: "checkout",
        number,
      }).success,
      false,
    );
  }
  assert.equal(
    gitOperationStartRequestSchema.safeParse({
      ...scope,
      kind: "checkout",
      number: 1,
    }).success,
    true,
  );
  for (const remoteUrl of [
    "",
    "   ",
    "bad\nremote",
    "bad\rremote",
    "bad\0remote",
    "x".repeat(4097),
  ]) {
    assert.equal(
      gitOperationStartRequestSchema.safeParse({
        ...scope,
        kind: "clone",
        remoteUrl,
      }).success,
      false,
    );
  }
  const remoteUrl = "--not-an-option ";
  const clone = gitOperationStartRequestSchema.parse({
    ...scope,
    kind: "clone",
    remoteUrl,
  });
  assert.equal(clone.kind === "clone" && clone.remoteUrl, remoteUrl);
  assert.equal(
    gitOperationStartRequestSchema.safeParse({
      ...scope,
      kind: "switchBaseAndPull",
      baseBranch: "",
    }).success,
    false,
  );
  assert.equal(
    gitOperationStartRequestSchema.safeParse({
      ...scope,
      kind: "fetch",
      repo: "x".repeat(1025),
    }).success,
    false,
  );
});

void test("bulk operations accept only bounded nonempty fetch/pull repositories", () => {
  const input = { projectId: "proj_test", kind: "fetch", repos: ["."] };
  for (const repos of [
    [],
    [""],
    ["x".repeat(1025)],
    Array.from({ length: 101 }, () => "a"),
  ]) {
    assert.equal(
      gitOperationBulkStartRequestSchema.safeParse({ ...input, repos }).success,
      false,
    );
  }
  assert.equal(
    gitOperationBulkStartRequestSchema.safeParse({ ...input, kind: "push" })
      .success,
    false,
  );
  assert.equal(
    gitOperationBulkStartRequestSchema.safeParse({
      ...input,
      kind: "pull",
      repos: Array.from({ length: 100 }, (_, index) => `repo-${index}`),
    }).success,
    true,
  );
});

void test("cached responses require explicit freshness and bound issue and PR lists", () => {
  assert.deepEqual(
    githubCachedListRequestSchema.parse({ projectId: "proj_test" }),
    { projectId: "proj_test", repo: ".", refresh: false },
  );
  const freshness = { status: "loading", refreshing: true, updatedAt: null };
  assert.equal(
    githubIssueListResponseSchema.safeParse({ issues: [], ...freshness })
      .success,
    true,
  );
  assert.equal(
    githubIssueListResponseSchema.safeParse({
      issues: [],
      refreshing: false,
      updatedAt: null,
    }).success,
    false,
  );
  assert.equal(
    githubPrCachedListResponseSchema.safeParse({ result: null, ...freshness })
      .success,
    true,
  );
  assert.equal(
    githubIssueListResponseSchema.safeParse({
      issues: [],
      ...freshness,
      status: "unknown",
    }).success,
    false,
  );
  assert.equal(
    githubIssueListResponseSchema.safeParse({
      issues: [],
      ...freshness,
      updatedAt: "yesterday",
    }).success,
    false,
  );
  const issue = {
    number: 1,
    title: "Issue",
    url: "https://github.com/example/repo/issues/1",
    state: "OPEN",
    updatedAt: "2026-10-18T00:00:00.000Z",
    author: null,
  };
  assert.equal(
    githubIssueListResponseSchema.safeParse({
      ...freshness,
      issues: Array.from({ length: 100 }, () => issue),
    }).success,
    true,
  );
  assert.equal(
    githubIssueListResponseSchema.safeParse({
      ...freshness,
      issues: Array.from({ length: 101 }, () => issue),
    }).success,
    false,
  );
  const pr = {
    number: 1,
    title: "PR",
    url: "https://github.com/example/repo/pull/1",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature",
    baseRefName: "main",
    updatedAt: issue.updatedAt,
    checks: {
      status: "none",
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      runs: [],
    },
  };
  assert.equal(
    githubPrCachedListResponseSchema.safeParse({
      ...freshness,
      result: { prs: Array.from({ length: 100 }, () => pr) },
    }).success,
    true,
  );
  assert.equal(
    githubPrCachedListResponseSchema.safeParse({
      ...freshness,
      result: { prs: Array.from({ length: 101 }, () => pr) },
    }).success,
    false,
  );
});
