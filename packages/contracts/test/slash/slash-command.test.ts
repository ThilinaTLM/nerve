import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSlashCommand,
  slashCommandCompletionItems,
} from "../../src/domains/completions/slash-command.js";

describe("slash commands", () => {
  it("parses every advertised command with its required arguments", () => {
    assert.deepEqual(
      slashCommandCompletionItems.map((item) => item.label),
      ["/plan", "/profile <name>", "/compact", "/abort", "/new"],
    );

    for (const item of slashCommandCompletionItems) {
      const text = item.label.replace("<name>", "planning");
      assert.deepEqual(
        parseSlashCommand(text),
        item.label === "/profile <name>"
          ? { name: "profile", profile: "planning" }
          : { name: item.label.slice(1) },
      );
    }
  });

  it("allows surrounding whitespace", () => {
    assert.deepEqual(parseSlashCommand(" \n /plan\t"), { name: "plan" });
  });

  it("does not reinterpret unknown or argument-bearing prompts", () => {
    for (const text of [
      "",
      "/status",
      "/Plan",
      "/plan inspect this",
      "/compact now",
      "please /abort",
    ]) {
      assert.equal(parseSlashCommand(text), undefined);
    }
  });
});
