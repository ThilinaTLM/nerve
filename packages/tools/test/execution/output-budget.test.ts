import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundContentBlocks,
  LIVE_OUTPUT_MAX_BYTES,
  MODEL_TEXT_MAX_LINES,
  MODEL_TOOL_RESULT_MAX_BYTES,
  splitLiveOutputChunks,
} from "../../src/execution/output/output-budget.js";

describe("live output framing", () => {
  it("losslessly splits ASCII and multibyte text within the byte budget", () => {
    const input = `${"x".repeat(20_000)}🙂${"界".repeat(4_000)}`;
    const chunks = splitLiveOutputChunks(input);

    assert.equal(chunks.join(""), input);
    assert.ok(chunks.length > 1);
    assert.ok(
      chunks.every(
        (chunk) => Buffer.byteLength(chunk, "utf8") <= LIVE_OUTPUT_MAX_BYTES,
      ),
    );
    assert.ok(chunks.every((chunk) => !chunk.endsWith("\ud83d")));
  });
});

describe("aggregate model tool-result output budget", () => {
  it("shares one byte budget across text blocks and emits one notice", () => {
    const result = boundContentBlocks(
      [
        { type: "text" as const, text: "a".repeat(16_000) },
        { type: "text" as const, text: "b".repeat(16_000) },
      ],
      { maxBytes: MODEL_TOOL_RESULT_MAX_BYTES },
      { recoveryHint: "Continue with offset 1000." },
    );
    const text = result.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(text, "utf8") <= MODEL_TOOL_RESULT_MAX_BYTES);
    assert.equal(text.match(/tool result truncated/g)?.length, 1);
    assert.match(text, /offset 1000/);
  });

  it("uses the exact agent notice within the aggregate line and byte limits", () => {
    const path =
      "/home/test/.nerve/data/conversations/test/tool-calls/test/result.json";
    const result = boundContentBlocks(
      [
        {
          type: "text" as const,
          text: `${"line\n".repeat(250)}${"🙂".repeat(8_000)}`,
        },
      ],
      {
        maxBytes: MODEL_TOOL_RESULT_MAX_BYTES,
        maxLines: MODEL_TEXT_MAX_LINES,
        maxLineChars: Number.MAX_SAFE_INTEGER,
      },
      { truncationNotice: `Output truncated. Full output: ${path}` },
    );
    const text = result.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(text, "utf8") <= MODEL_TOOL_RESULT_MAX_BYTES);
    assert.ok(text.split("\n").length <= MODEL_TEXT_MAX_LINES);
    assert.ok(text.endsWith(`Output truncated. Full output: ${path}`));
    assert.equal(text.includes("omitted"), false);
    assert.equal(text.includes("Continue with"), false);
    assert.equal(text.includes("\ud83d\n"), false);
  });

  it("bounds an extremely wide line only by UTF-8 bytes", () => {
    const path = "/payloads/wide.json";
    const result = boundContentBlocks(
      [{ type: "text" as const, text: "🙂".repeat(10_000) }],
      {
        maxBytes: MODEL_TOOL_RESULT_MAX_BYTES,
        maxLines: MODEL_TEXT_MAX_LINES,
        maxLineChars: Number.MAX_SAFE_INTEGER,
      },
      { truncationNotice: `Output truncated. Full output: ${path}` },
    );
    const block = result.contentBlocks[0];
    assert.equal(block?.type, "text");
    const text = block?.type === "text" ? block.text : "";
    assert.ok(Buffer.byteLength(text, "utf8") <= MODEL_TOOL_RESULT_MAX_BYTES);
    assert.equal(text.includes("overlong line"), false);
    assert.equal(Buffer.from(text, "utf8").toString("utf8"), text);
    assert.ok(text.endsWith(`Output truncated. Full output: ${path}`));
  });

  it("does not apply a separate model per-line character limit", () => {
    const text = "x".repeat(10_000);
    const result = boundContentBlocks([{ type: "text" as const, text }], {
      maxBytes: MODEL_TOOL_RESULT_MAX_BYTES,
      maxLines: MODEL_TEXT_MAX_LINES,
      maxLineChars: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(result.truncated, false);
    assert.equal(result.contentBlocks[0]?.type, "text");
    assert.equal(result.contentBlocks[0]?.text, text);
  });

  it("preserves image blocks and their order while bounding surrounding text", () => {
    const image = {
      type: "image" as const,
      data: "base64",
      mimeType: "image/png",
    };
    const result = boundContentBlocks(
      [
        { type: "text" as const, text: "first\n".repeat(700) },
        image,
        { type: "text" as const, text: "second\n".repeat(700) },
      ],
      { maxBytes: 4_000, maxLines: 1_000, maxLineChars: 4_096 },
    );

    assert.equal(result.contentBlocks[1], image);
    assert.equal(result.contentBlocks[0]?.type, "text");
    assert.equal(result.contentBlocks[2]?.type, "text");
    const text = result.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.ok(Buffer.byteLength(text, "utf8") <= 4_000);
  });
});
