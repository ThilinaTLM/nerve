import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSlashCommand,
  slashCommandCompletionItems,
  slashCommandItemsForProfiles,
} from "../../src/domains/completions/slash-command.js";

test("profile requires one valid name; plan remains a shortcut and code is removed", () => {
  assert.deepEqual(parseSlashCommand(" /profile planning "), {
    name: "profile",
    profile: "planning",
  });
  assert.deepEqual(parseSlashCommand("/plan"), { name: "plan" });
  for (const text of [
    "/code",
    "/profile",
    "/profile bad/name",
    "/profile coding extra",
    "/plan coding",
  ])
    assert.equal(parseSlashCommand(text), undefined);
});

test("profile completions expand the contract argument with available lead profiles", () => {
  const items = slashCommandItemsForProfiles(slashCommandCompletionItems, [
    { name: "coding", label: "Coding" },
  ]);
  assert.ok(items.some((item) => item.label === "/profile coding"));
  assert.ok(
    !items.some(
      (item) => item.label === "/profile <name>" || item.label === "/code",
    ),
  );
});
