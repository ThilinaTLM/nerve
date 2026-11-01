import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRestChecks } from "./git-github-checks.js";
import {
  GithubApiClient,
  GithubRateLimitError,
} from "./git-github-api-client.js";

const repository = {
  hostname: "github.com" as const,
  owner: "owner",
  repo: "repo",
  remoteUrl: "https://github.com/owner/repo",
};

void test("REST check mapping preserves rollup semantics and failure metadata", () => {
  const checks = summarizeRestChecks(
    [
      {
        name: "build",
        status: "completed",
        conclusion: "failure",
        app: { name: "Actions" },
        output: { title: "Compile error" },
        started_at: "start",
        completed_at: "end",
      },
      { name: "lint", status: "completed", conclusion: "neutral" },
      { name: "test", status: "in_progress", conclusion: null },
    ],
    {
      statuses: [
        {
          context: "deploy",
          state: "success",
          target_url: "https://example.com",
        },
      ],
    },
  );
  assert.equal(checks.status, "failing");
  assert.deepEqual(
    [checks.total, checks.passed, checks.failed, checks.pending],
    [4, 2, 1, 1],
  );
  assert.deepEqual(checks.runs[0], {
    name: "build",
    status: "failure",
    conclusion: "failure",
    url: undefined,
    workflow: "Actions",
    summary: "Compile error",
    startedAt: "start",
    completedAt: "end",
  });
});

void test("conditional API requests send ETags, preserve headers and handle 304 without JSON", async () => {
  const requests: RequestInit[] = [];
  const client = new GithubApiClient({
    tokenProvider: async () => "test",
    fetch: async (_url, init) => {
      requests.push(init!);
      return requests.length === 1
        ? new Response(JSON.stringify([{ number: 1 }]), {
            headers: { etag: 'W/"test"', "x-ratelimit-remaining": "99" },
          })
        : new Response(null, {
            status: 304,
            headers: { "x-poll-interval": "60" },
          });
    },
  });
  try {
    const first = await client.probe(repository, "/pulls");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-ratelimit-remaining"), "99");
    const second = await client.probe(repository, "/pulls", 'W/"test"');
    assert.equal(second.status, 304);
    assert.equal(
      new Headers(requests[1].headers).get("if-none-match"),
      'W/"test"',
    );
    assert.equal(second.headers.get("x-poll-interval"), "60");
  } finally {
    await client.close();
  }
});

void test("secondary limit exposes retry headers", async () => {
  const client = new GithubApiClient({
    tokenProvider: async () => "test",
    fetch: async () =>
      new Response("secondary rate limit", {
        status: 403,
        headers: { "retry-after": "120" },
      }),
  });
  try {
    await assert.rejects(
      client.probe(repository, "/pulls"),
      (error) =>
        error instanceof GithubRateLimitError &&
        error.headers.get("retry-after") === "120",
    );
  } finally {
    await client.close();
  }
});
