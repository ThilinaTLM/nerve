import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GithubApiClient } from "../src/git/git-github-api-client.js";
import {
  parseGithubRepositoryRemote,
  parseGithubRepositoryUrl,
} from "../src/git/git-github-parsers.js";

const repository = {
  hostname: "github.com" as const,
  owner: "example",
  repo: "repo",
  remoteUrl: "git@github.com:example/repo.git",
};

describe("GitHub repository parsing", () => {
  it("parses HTTPS, SSH, and SCP-like remotes", () => {
    assert.deepEqual(parseGithubRepositoryUrl("https://github.com/a/b.git"), {
      hostname: "github.com",
      owner: "a",
      repo: "b",
      remoteUrl: "https://github.com/a/b.git",
    });
    assert.equal(
      parseGithubRepositoryUrl("ssh://git@github.com/a/b.git")?.repo,
      "b",
    );
    assert.equal(
      parseGithubRepositoryUrl("git@github.com:a/b.git")?.owner,
      "a",
    );
    assert.equal(parseGithubRepositoryUrl("https://gitlab.com/a/b.git"), null);
  });

  it("prefers the origin fetch remote", () => {
    const result = parseGithubRepositoryRemote(
      "upstream\tgit@github.com:other/upstream.git (fetch)\n" +
        "origin\thttps://github.com/example/repo.git (push)\n" +
        "origin\thttps://github.com/example/repo.git (fetch)\n",
    );
    assert.equal(result?.owner, "example");
    assert.equal(result?.repo, "repo");
  });
});

describe("GithubApiClient", () => {
  it("deduplicates token acquisition and sends bearer authentication", async () => {
    let tokenCalls = 0;
    const headers: string[] = [];
    const client = new GithubApiClient({
      tokenProvider: async () => {
        tokenCalls += 1;
        return "secret-token";
      },
      fetch: async (_input, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json({ login: "octocat" });
      },
    });
    await Promise.all([
      client.rest(repository, "/user", { operation: "one" }),
      client.rest(repository, "/user", { operation: "two" }),
    ]);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(headers, ["Bearer secret-token", "Bearer secret-token"]);
  });

  it("reacquires once after a 401", async () => {
    let tokenCalls = 0;
    let requests = 0;
    const client = new GithubApiClient({
      tokenProvider: async () => `token-${++tokenCalls}`,
      fetch: async () => {
        requests += 1;
        return requests === 1
          ? new Response(null, { status: 401 })
          : Response.json({ login: "octocat" });
      },
    });
    const result = await client.rest<{ login: string }>(repository, "/user", {
      operation: "status",
    });
    assert.equal(result.login, "octocat");
    assert.equal(tokenCalls, 2);
  });

  it("never includes a token in API errors", async () => {
    const client = new GithubApiClient({
      tokenProvider: async () => "highly-secret-token",
      fetch: async () => new Response("highly-secret-token", { status: 403 }),
    });
    await assert.rejects(
      client.rest(repository, "/user", { operation: "status" }),
      (error: Error) => !error.message.includes("highly-secret-token"),
    );
  });
});
