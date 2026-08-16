import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendedNewline,
  splitStreamingMarkdown,
} from "./streaming-markdown.js";

describe("splitStreamingMarkdown", () => {
  it("keeps the unresolved paragraph in the escaped tail", () => {
    assert.deepEqual(splitStreamingMarkdown("First **done**\n\nPartial *"), {
      prefix: "First **done**\n\n",
      tail: "Partial *",
    });
  });

  it("does not split at blank lines inside backtick or tilde fences", () => {
    for (const marker of ["```", "~~~"]) {
      const source = `Before\n\n${marker}ts\nline\n\nmore`;
      assert.deepEqual(splitStreamingMarkdown(source), {
        prefix: "Before\n\n",
        tail: `${marker}ts\nline\n\nmore`,
      });
    }
  });

  it("advances again after a fence closes and a blank line arrives", () => {
    const source = "```ts\nconst x = 1\n```\n\nNext";
    assert.deepEqual(splitStreamingMarkdown(source), {
      prefix: "```ts\nconst x = 1\n```\n\n",
      tail: "Next",
    });
  });

  it("moves a completed Mermaid fence into the renderable prefix", () => {
    const diagram = "```mermaid\nflowchart TD\n  A --> B\n```\n\n";
    assert.deepEqual(splitStreamingMarkdown(`${diagram}Still streaming`), {
      prefix: diagram,
      tail: "Still streaming",
    });
  });
});

describe("appendedNewline", () => {
  it("detects only newly appended newline content", () => {
    assert.equal(appendedNewline("a", "a\n"), true);
    assert.equal(appendedNewline("a\n", "a\nb"), false);
    assert.equal(appendedNewline("long", "short"), false);
  });
});
