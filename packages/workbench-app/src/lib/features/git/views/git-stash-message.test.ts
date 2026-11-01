import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStashMessage } from "./git-stash-message";

test("parses WIP stash subjects", () => {
  assert.deepEqual(parseStashMessage("WIP on feat/x: 1a2b3c4 Fix the thing"), {
    title: "Fix the thing",
    branch: "feat/x",
    wip: true,
  });
});

test("parses named stash subjects", () => {
  assert.deepEqual(parseStashMessage("On main: before rebase"), {
    title: "before rebase",
    branch: "main",
    wip: false,
  });
});

test("falls back to the raw message", () => {
  assert.deepEqual(parseStashMessage("custom text"), {
    title: "custom text",
    wip: false,
  });
});
