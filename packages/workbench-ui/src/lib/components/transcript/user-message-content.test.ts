import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatInlineCommandResultText } from "@nervekit/contracts";
import { segmentUserMessageText } from "./user-message-content.js";

describe("segmentUserMessageText", () => {
  it("returns a single text segment for plain prompts", () => {
    const segments = segmentUserMessageText("Just a question about code.");
    assert.deepEqual(segments, [
      { kind: "text", text: "Just a question about code." },
    ]);
  });

  it("keeps ordinary code fences as plain text", () => {
    const text = "Look:\n```sh\nls -la\n```\nthanks";
    assert.deepEqual(segmentUserMessageText(text), [{ kind: "text", text }]);
  });

  it("splits expanded command results out of the prompt text", () => {
    const result = formatInlineCommandResultText({
      command: "git status",
      output: "clean",
      status: "completed",
      exitCode: 0,
    });
    const segments = segmentUserMessageText(
      `Use this:\n${result}\nand summarize.`,
    );
    assert.deepEqual(segments, [
      { kind: "text", text: "Use this:" },
      {
        kind: "command_result",
        command: "git status",
        status: "completed",
        exitCode: 0,
        output: "clean",
      },
      { kind: "text", text: "and summarize." },
    ]);
  });

  it("normalizes the (no output) placeholder to an empty output", () => {
    const result = formatInlineCommandResultText({
      command: "true",
      output: "",
      status: "completed",
      exitCode: 0,
    });
    const [segment] = segmentUserMessageText(result);
    assert.equal(segment.kind, "command_result");
    assert.equal(segment.kind === "command_result" && segment.output, "");
  });

  it("marks raw !!! blocks as pending commands", () => {
    const segments = segmentUserMessageText(
      "Check:\n```!!!\ngit status\n```\nplease",
    );
    assert.deepEqual(segments, [
      { kind: "text", text: "Check:" },
      { kind: "command_pending", command: "git status" },
      { kind: "text", text: "please" },
    ]);
  });

  it("does not extract raw blocks nested inside a result output", () => {
    const result = formatInlineCommandResultText({
      command: "cat prompt.md",
      output: "```!!!\nrm -rf /\n```",
      status: "completed",
      exitCode: 0,
    });
    const segments = segmentUserMessageText(result);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].kind, "command_result");
  });
});
