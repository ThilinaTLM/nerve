import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  hasExecutableCommandBlocks,
  isInlineCommandPrompt,
  parseInlineCommandPrompt,
  replaceExecutableCommandBlocks,
} from "../src/core/inline-commands.js";

describe("inline command prompts", () => {
  it("detects prompts whose first non-whitespace character is !", () => {
    assert.deepEqual(parseInlineCommandPrompt("!git status"), {
      command: "git status",
      bangOffset: 0,
    });
    assert.deepEqual(parseInlineCommandPrompt("  \n\t ! pwd "), {
      command: "pwd",
      bangOffset: 5,
    });
    assert.equal(isInlineCommandPrompt("hello ! pwd"), false);
    assert.equal(isInlineCommandPrompt("!   \n"), false);
  });
});

describe("inline command result formatting", () => {
  it("formats command output for transcript display", () => {
    assert.equal(
      formatInlineCommandResultText({
        command: "printf hi",
        output: "hi",
        status: "completed",
        exitCode: 0,
      }),
      "```\n$ printf hi\n\n> exit code: 0, status: completed\nhi\n```",
    );
  });

  it("uses a longer fence when output contains backticks", () => {
    assert.match(
      formatInlineCommandResultText({
        command: "echo ticks",
        output: "```",
        status: "completed",
      }),
      /^````\n\$ echo ticks/,
    );
  });
});

describe("executable command blocks", () => {
  it("finds exact !!! fenced blocks", () => {
    const text = [
      "Before",
      "```!!!",
      "git status --short",
      "```",
      "After",
    ].join("\n");

    const [block] = findExecutableCommandBlocks(text);
    assert.ok(block);
    assert.equal(block.command, "git status --short");
    assert.equal(
      text.slice(block.commandStart, block.commandEnd),
      "git status --short\n",
    );
    assert.equal(hasExecutableCommandBlocks(text), true);
  });

  it("supports tilde fences and indented fences", () => {
    const text = "   ~~~!!!\nprintf hi\n   ~~~\n";
    const [block] = findExecutableCommandBlocks(text);
    assert.equal(block?.fenceChar, "~");
    assert.equal(block?.command, "printf hi");
  });

  it("ignores non-executable fence info strings", () => {
    const text = [
      "```bash",
      "echo no",
      "```",
      "``` !!!!",
      "echo no",
      "```",
      "```!!! extra",
      "echo no",
      "```",
    ].join("\n");
    assert.deepEqual(findExecutableCommandBlocks(text), []);
  });

  it("replaces executable blocks in source order", () => {
    const text = "a\n```!!!\none\n```\nb\n```!!!\ntwo\n```\nc";
    const blocks = findExecutableCommandBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(
      replaceExecutableCommandBlocks(text, [
        { block: blocks[0], text: "ONE" },
        { block: blocks[1], text: "TWO" },
      ]),
      "a\nONE\nb\nTWO\nc",
    );
  });
});
