import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMermaidMarkdownBlocks,
  fingerprintMermaidSource,
  resolveMermaidMarkdownBlock,
} from "./mermaid-blocks.js";

describe("Mermaid Markdown blocks", () => {
  it("extracts Mermaid fences with ordinals and absolute lines", () => {
    const blocks = extractMermaidMarkdownBlocks(
      "# Design\n\n```ts\nconst x = 1\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```MERMAID\nsequenceDiagram\n  A->>B: Hi\n```",
      20,
    );

    assert.equal(blocks.length, 2);
    assert.deepEqual(
      blocks.map((block) => ({
        ordinal: block.locator.ordinal,
        line: block.locator.startLine,
        source: block.source,
      })),
      [
        { ordinal: 0, line: 26, source: "flowchart TD\n  A --> B" },
        { ordinal: 1, line: 31, source: "sequenceDiagram\n  A->>B: Hi" },
      ],
    );
  });

  it("normalizes line endings and trailing whitespace for fingerprints", () => {
    assert.equal(
      fingerprintMermaidSource("flowchart TD\r\nA --> B\n\n"),
      fingerprintMermaidSource("flowchart TD\nA --> B"),
    );
  });

  it("follows a matching block when diagrams move", () => {
    const original = extractMermaidMarkdownBlocks(
      "```mermaid\nflowchart TD\nA --> B\n```\n\n```mermaid\nflowchart LR\nC --> D\n```",
    )[1];
    const moved = extractMermaidMarkdownBlocks(
      "```mermaid\nflowchart LR\nC --> D\n```\n\n```mermaid\nflowchart TD\nA --> B\n```",
    );

    const resolved = resolveMermaidMarkdownBlock(moved, original.locator, {
      completeDocument: true,
    });
    assert.equal(resolved?.source, original.source);
    assert.equal(resolved?.locator.ordinal, 0);
  });

  it("uses the original ordinal for an edited complete document", () => {
    const original = extractMermaidMarkdownBlocks(
      "```mermaid\nflowchart TD\nA --> B\n```",
    )[0];
    const edited = extractMermaidMarkdownBlocks(
      "```mermaid\nflowchart TD\nA --> C\n```",
    );

    assert.equal(
      resolveMermaidMarkdownBlock(edited, original.locator, {
        completeDocument: true,
      })?.source,
      "flowchart TD\nA --> C",
    );
  });

  it("uses the nearest line for an edited partial window", () => {
    const locator = {
      ordinal: 8,
      startLine: 500,
      fingerprint: fingerprintMermaidSource("old"),
    };
    const window = extractMermaidMarkdownBlocks(
      "```mermaid\nnear\n```\n\n\n```mermaid\nfar\n```",
      498,
    );

    assert.equal(
      resolveMermaidMarkdownBlock(window, locator, {
        completeDocument: false,
      })?.source,
      "near",
    );
    assert.equal(
      resolveMermaidMarkdownBlock([], locator, { completeDocument: false }),
      undefined,
    );
  });

  it("disambiguates duplicate sources by the nearest line", () => {
    const blocks = extractMermaidMarkdownBlocks(
      "```mermaid\nsame\n```\n\n\n```mermaid\nsame\n```",
      40,
    );
    const resolved = resolveMermaidMarkdownBlock(
      blocks,
      { ...blocks[0].locator, startLine: 47 },
      { completeDocument: true },
    );
    assert.equal(resolved?.locator.startLine, blocks[1].locator.startLine);
  });
});
