import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPromptReferences as prompts,
  extractCreatedReference as created,
  parseGitRemote,
} from "./github.js";
const remote = { host: "git.acme.test", owner: "Acme", repo: "API" };
test("canonical URLs normalize identity and resolve comments/reviews to the parent", () => {
  const refs = prompts(
    "Review https://github.com/Acme/API/pull/481/files?x=1#discussion_r2 and (https://github.com/Acme/API/issues/2#issuecomment-1).",
  );
  assert.deepEqual(
    refs.map((r) => [r.resourceKey, r.kind, r.url]),
    [
      [
        "github.com/acme/api#481",
        "pull_request",
        "https://github.com/Acme/API/pull/481",
      ],
      [
        "github.com/acme/api#2",
        "issue",
        "https://github.com/Acme/API/issues/2",
      ],
    ],
  );
  assert.equal(prompts("https://evil.test/a/b/pull/1").length, 0);
  assert.equal(
    prompts("https://git.acme.test/Acme/API/pull/2", [remote]).length,
    1,
  );
  assert.equal(prompts("http://github.com/a/b/issues/1")[0].url, null);
});
test("shorthand supports cues, unknown kind, and unambiguous bare numbers only", () => {
  assert.deepEqual(
    prompts("a/b#1 https://github.com/a/b/pull/2 a/b#3").map(
      (r) => r.identifier,
    ),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    prompts("PR Acme/API#1 issue Acme/API#2 Acme/API#3").map((r) => r.kind),
    ["pull_request", "issue", "unknown"],
  );
  assert.equal(prompts("PR #1").length, 0);
  assert.equal(
    prompts("PR #1", [remote, { ...remote, repo: "other" }]).length,
    0,
  );
  assert.equal(
    prompts("PR #1", [remote])[0].resourceKey,
    "git.acme.test/acme/api#1",
  );
  assert.equal(prompts("#1", [remote]).length, 0);
  assert.equal(prompts("PR #1", [remote, remote]).length, 1);
});
test("fenced code is ignored including tilde and unclosed fences", () => {
  assert.equal(
    prompts(
      "```log\nhttps://github.com/a/b/pull/1\n```\n~~~\na/b#2\n~~~\na/b#3\n```\na/b#4",
    ).length,
    1,
  );
});
test("local git remotes parse HTTPS, SSH and scp forms", () => {
  for (const url of [
    "https://git.acme.test/Acme/API.git",
    "ssh://git@git.acme.test/Acme/API.git",
    "ssh://git@git.acme.test:2222/Acme/API.git",
    "git@git.acme.test:Acme/API.git",
  ])
    assert.deepEqual(parseGitRemote(url), remote);
});
test("creation requires an actual successful gh create command and matching URL, taking the last", () => {
  const output = "https://github.com/a/b/pull/1\nhttps://github.com/a/b/pull/2";
  assert.equal(
    created("gh pr create --title 'hello'", 0, output)?.identifier,
    "2",
  );
  assert.equal(
    created("gh issue create", 0, "https://github.com/a/b/issues/3")
      ?.relationship,
    "created",
  );
  for (const [command, code, text] of [
    ["gh pr create", 1, output],
    ["gh pr view", 0, output],
    ["echo 'gh pr create'", 0, output],
    ["echo '; gh pr create'", 0, output],
    ["./create-pr.sh", 0, output],
    ["gh pr create", 0, "created!"],
    ["gh issue create", 0, output],
  ] as const)
    assert.equal(created(command, code, text), null);
});
