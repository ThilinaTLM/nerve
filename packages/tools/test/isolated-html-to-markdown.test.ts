import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTML_CONVERSION_MAX_INPUT_BYTES,
  HtmlConversionError,
  isolatedHtmlToMarkdown,
} from "../src/execution/common/isolated-html-to-markdown.js";

function errorCode(error: unknown): string | undefined {
  return error instanceof HtmlConversionError ? error.code : undefined;
}

describe("isolated HTML to Markdown conversion", () => {
  it("rejects oversized input before starting a worker", async () => {
    await assert.rejects(
      isolatedHtmlToMarkdown("x".repeat(HTML_CONVERSION_MAX_INPUT_BYTES + 1)),
      (error) => errorCode(error) === "HTML_CONVERSION_INPUT_TOO_LARGE",
    );
  });

  it("terminates timed-out and aborted conversions", async () => {
    const source = `<div>${"<span>content</span>".repeat(20_000)}</div>`;
    await assert.rejects(
      isolatedHtmlToMarkdown(source, { timeoutMs: 1 }),
      (error) => errorCode(error) === "HTML_CONVERSION_TIMEOUT",
    );

    const controller = new AbortController();
    const pending = isolatedHtmlToMarkdown(source, {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(
      pending,
      (error) => errorCode(error) === "HTML_CONVERSION_ABORTED",
    );
  });
});
