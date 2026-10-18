import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gitProgressParser,
  safeGitFailure,
  type GitProgress,
} from "../../src/git/git-progress.js";

test("progress parser accepts CR/chunk splits and remote phases, rejects unbounded/unknown text", () => {
  const values: GitProgress[] = [];
  const parse = gitProgressParser((value) => values.push(value));
  parse(Buffer.from("Receiving obj"));
  parse(Buffer.from("ects: 42% (42/100)\rremote: Counting objects: 100%\n"));
  parse(
    "secret credential text\nWriting objects: 101%\n" + "a".repeat(100_000),
  );
  parse("\rsecretToken: 42%\rResolving deltas: 7%\r");
  assert.deepEqual(values, [
    { phase: "Receiving objects", completed: 42, total: 100 },
    { phase: "Counting objects", completed: 100, total: 100 },
    { phase: "Working" },
    { phase: "Resolving deltas", completed: 7, total: 100 },
  ]);
});
test("activity failures never expose raw credential/URL/hook output", () => {
  const value = safeGitFailure(
    new Error(
      "https://user:secret@remote.invalid hook: token=abc " +
        "x".repeat(100_000),
    ),
  );
  assert.ok(value.message.length < 200);
  assert.doesNotMatch(value.message, /secret|token|remote.invalid/);
  assert.equal(
    safeGitFailure(new Error("Git operation admission is full")).category,
    "capacity",
  );
  assert.equal(
    safeGitFailure(new DOMException("secret", "AbortError")).category,
    "cancelled",
  );
});

test("typed command failures survive workflow mapping without exposing diagnostics", async () => {
  const { GitService } = await import("../../src/git/git-service.js");
  const { GitCommandError, GitWorkflowError } =
    await import("../../src/git/git-errors.js");
  const service = new GitService(() => ({ dir: "/unused", name: "test" }));
  const cases = [
    [
      "error: Your local changes to the following files would be overwritten by checkout:",
      "local-changes",
    ],
    [
      "error: Your local changes to the following files would be overwritten by merge:",
      "local-changes",
    ],
    [
      "error: The following untracked working tree files would be overwritten by checkout:",
      "untracked-files",
    ],
    ["error: you need to resolve your current index first", "unmerged-files"],
    ["fatal: Not possible to fast-forward, aborting.", "non-fast-forward"],
    ["error: branch 'secret-branch' is not fully merged.", "branch-not-merged"],
  ] as const;
  for (const [diagnostic, category] of cases) {
    const original = new GitCommandError(
      "git switch token=secret",
      1,
      `${diagnostic}\n\t/private/secret-path\nhttps://user:password@remote.invalid`,
      "token=secret",
    );
    await assert.rejects(
      service.mapGit(async () => {
        throw original;
      }),
      (error: unknown) => {
        assert.ok(error instanceof GitWorkflowError);
        assert.equal(error.cause, original);
        const failure = safeGitFailure(error);
        assert.equal(failure.category, category);
        assert.doesNotMatch(
          JSON.stringify(failure),
          /secret|private|password|remote.invalid|git switch/,
        );
        assert.ok(failure.message.length < 200);
        return true;
      },
    );
    // A random Error that looks like Git output is not a classified command failure.
    assert.equal(safeGitFailure(new Error(diagnostic)).category, "git");
  }
  const { GitCommandError: CommandError } =
    await import("../../src/git/git-command.js");
  assert.equal(
    safeGitFailure(new CommandError("git", null, "private", "", "timeout"))
      .category,
    "timeout",
  );
  assert.equal(
    safeGitFailure(new Error("Git command timed out token=secret")).category,
    "git",
  );
  assert.deepEqual(
    safeGitFailure(new GitWorkflowError(409, "GIT_NO_UPSTREAM", "secret-path")),
    {
      category: "GIT_NO_UPSTREAM",
      message: "Configure an upstream tracking branch before retrying.",
    },
  );
});
