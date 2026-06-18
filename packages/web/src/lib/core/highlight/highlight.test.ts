import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { highlightCodeCached, normalizeHighlightLanguage } from "./highlight";

describe("highlight", () => {
  it("normalizes common language aliases", () => {
    assert.equal(normalizeHighlightLanguage("ts"), "typescript");
    assert.equal(normalizeHighlightLanguage("md"), "markdown");
    assert.equal(normalizeHighlightLanguage("shell"), "shellscript");
    assert.equal(normalizeHighlightLanguage("unknown-language"), undefined);
  });

  it("reuses in-flight and resolved cached highlight results", async () => {
    const code = `const cacheProbe: number = ${Date.now()};`;

    const first = highlightCodeCached(code, "ts");
    const second = highlightCodeCached(code, "typescript");

    assert.ok(first instanceof Promise);
    assert.equal(first, second);

    const html = await first;
    if (typeof html !== "string") assert.fail("expected highlighted HTML");
    assert.ok(html.includes("shiki"));
    assert.ok(html.includes("cacheProbe"));

    const resolved = highlightCodeCached(code, "typescript");
    assert.equal(resolved, html);
  });

  it("returns undefined for unsupported languages", () => {
    assert.equal(highlightCodeCached("plain text", "madeuplang"), undefined);
  });
});
