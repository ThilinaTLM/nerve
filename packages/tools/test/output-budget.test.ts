import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundContentBlocks,
  LIVE_OUTPUT_MAX_BYTES,
  MODEL_TOOL_RESULT_MAX_BYTES,
  splitLiveOutputChunks,
} from "../src/execution/common/output-budget.js";

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
