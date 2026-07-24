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
  it("converts HTML without blocking the host event loop", async () => {
    const source = `<main>${"<p>Hello <strong>worker</strong></p>".repeat(2_000)}</main>`;
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 0);
    const markdown = await isolatedHtmlToMarkdown(source);
    clearTimeout(timer);

    assert.equal(timerFired, true);
    assert.match(markdown, /Hello \*\*worker\*\*/);
  });

  it("converts Confluence storage markup in the worker", async () => {
    const markdown = await isolatedHtmlToMarkdown(
      `<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[const value = 1;]]></ac:plain-text-body></ac:structured-macro>`,
      { mode: "confluence-storage" },
    );

    assert.match(markdown, /const value = 1;/);
    assert.match(markdown, /```/);
  });

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

  it("bounds the conversion queue under parallel load", async () => {
    const source = `<div>${"<span>content</span>".repeat(2_000)}</div>`;
    const accepted = Array.from({ length: 18 }, () =>
      isolatedHtmlToMarkdown(source, { timeoutMs: 1 }),
    );
    await assert.rejects(
      isolatedHtmlToMarkdown(source, { timeoutMs: 1 }),
      (error) => errorCode(error) === "HTML_CONVERSION_QUEUE_FULL",
    );
    await Promise.allSettled(accepted);

    const markdown = await isolatedHtmlToMarkdown("<p>capacity restored</p>");
    assert.equal(markdown, "capacity restored");
  });
});
