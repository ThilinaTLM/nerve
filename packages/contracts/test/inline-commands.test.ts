import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findExecutableCommandBlocks,
  findInlineCommandResultBlocks,
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

describe("inline command result blocks", () => {
  it("round-trips a simple formatted result", () => {
    const text = formatInlineCommandResultText({
      command: "printf hi",
      output: "hi",
      status: "completed",
      exitCode: 0,
    });
    const [block] = findInlineCommandResultBlocks(text);
    assert.ok(block);
    assert.equal(block.command, "printf hi");
    assert.equal(block.status, "completed");
    assert.equal(block.exitCode, 0);
    assert.equal(block.output, "hi");
    assert.equal(text.slice(block.start, block.end), text);
  });

  it("round-trips multi-line commands and multi-line output", () => {
    const text = [
      "Intro",
      formatInlineCommandResultText({
        command: "git status \\\n  --short",
        output: "one\n\ntwo",
        status: "completed",
        exitCode: 1,
      }),
      "Outro",
    ].join("\n");
    const [block] = findInlineCommandResultBlocks(text);
    assert.ok(block);
    assert.equal(block.command, "git status \\\n  --short");
    assert.equal(block.exitCode, 1);
    assert.equal(block.output, "one\n\ntwo");
  });

  it("round-trips results without an exit code and without output", () => {
    const text = formatInlineCommandResultText({
      command: "true",
      output: "",
      status: "failed",
    });
    const [block] = findInlineCommandResultBlocks(text);
    assert.ok(block);
    assert.equal(block.exitCode, undefined);
    assert.equal(block.status, "failed");
    assert.equal(block.output, "(no output)");
  });

  it("round-trips output containing triple backticks via longer fences", () => {
    const text = formatInlineCommandResultText({
      command: "cat snippet.md",
      output: "```js\ncode\n```",
      status: "completed",
      exitCode: 0,
    });
    const [block] = findInlineCommandResultBlocks(text);
    assert.ok(block);
    assert.equal(block.output, "```js\ncode\n```");
  });

  it("parses negative exit codes", () => {
    const text = formatInlineCommandResultText({
      command: "crash",
      output: "boom",
      status: "completed",
      exitCode: -1,
    });
    assert.equal(findInlineCommandResultBlocks(text)[0]?.exitCode, -1);
  });

  it("ignores ordinary code fences and near-miss formats", () => {
    const text = [
      "```sh",
      "$ ls",
      "",
      "> exit code: 0, status: completed",
      "out",
      "```",
      "```",
      "$ ls",
      "out without status line",
      "```",
      "```",
      "no dollar prefix",
      "",
      "> status: completed",
      "out",
      "```",
    ].join("\n");
    assert.deepEqual(findInlineCommandResultBlocks(text), []);
  });

  it("finds multiple result blocks in source order", () => {
    const first = formatInlineCommandResultText({
      command: "pwd",
      output: "/tmp",
      status: "completed",
      exitCode: 0,
    });
    const second = formatInlineCommandResultText({
      command: "false",
      output: "",
      status: "completed",
      exitCode: 1,
    });
    const text = `Check these:\n${first}\nand\n${second}\ndone`;
    const blocks = findInlineCommandResultBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].command, "pwd");
    assert.equal(blocks[1].command, "false");
    assert.equal(blocks[1].exitCode, 1);
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
