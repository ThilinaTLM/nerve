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
