import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSlashCommand,
  slashCommandCompletionItems,
} from "../src/domains/completions/slash-command.js";

describe("slash commands", () => {
  it("parses every advertised standalone command", () => {
    assert.deepEqual(
      slashCommandCompletionItems.map((item) => item.label),
      ["/plan", "/code", "/compact", "/abort"],
    );

    for (const item of slashCommandCompletionItems) {
      assert.deepEqual(parseSlashCommand(item.label), {
        name: item.label.slice(1),
      });
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
