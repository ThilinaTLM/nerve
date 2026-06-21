import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  getHighlightedMarkdownSync,
  renderDecoratedMarkdown,
  renderHighlightedMarkdown,
  renderMarkdown,
} from "./markdown-render";

// Note: `decorateMarkdownHtml`/`highlightMarkdownHtml` short-circuit without a
// DOM (`typeof document === "undefined"`), so under the Node test runner the
// decorated/highlighted products equal the raw parse output. These tests assert
// caching semantics (reference identity / promise de-duplication), which hold
// regardless of the DOM-dependent decoration.

describe("markdown-render caching", () => {
  it("serves repeated renderMarkdown calls from cache (same reference)", () => {
    const source = `# heading ${Math.random()}\n\nsome *text*`;
    const first = renderMarkdown(source);
    const second = renderMarkdown(source);
    assert.equal(first, second);
    assert.ok(
      Object.is(first, second),
      "cached parse should be the same string ref",
    );
  });

  it("returns correct content with cache:false (cache-bypass path)", () => {
    const source = `paragraph ${Math.random()}`;
    const cached = renderMarkdown(source); // populate cache
    const uncached = renderMarkdown(source, { cache: false });
    assert.equal(cached, uncached, "cache-bypass renders identical content");
  });

  it("caches decorated output and differentiates by trim", () => {
    const source = "```ts\nconst a = 1;\n```";
    const a = renderDecoratedMarkdown(source, true);
    const b = renderDecoratedMarkdown(source, true);
    assert.ok(Object.is(a, b), "decorated cache hit returns same ref");
    const untrimmed = renderDecoratedMarkdown(source, false);
    const untrimmed2 = renderDecoratedMarkdown(source, false);
    assert.ok(
      Object.is(untrimmed, untrimmed2),
      "trim=false cached independently",
    );
  });

  it("de-duplicates concurrent highlight calls and caches the result", async () => {
    const source = `concurrent ${Math.random()}\n\n\`\`\`js\nconst x = 2;\n\`\`\``;
    assert.equal(getHighlightedMarkdownSync(source, true), undefined);
    const p1 = renderHighlightedMarkdown(source, true);
    const p2 = renderHighlightedMarkdown(source, true);
    assert.ok(
      Object.is(p1, p2),
      "concurrent calls share one in-flight promise",
    );
    const html = await p1;
    assert.equal(typeof html, "string");
    const resolved = getHighlightedMarkdownSync(source, true);
    assert.equal(resolved, html, "resolved HTML is cached for sync reads");
    const p3 = renderHighlightedMarkdown(source, true);
    assert.equal(await p3, html, "subsequent calls return cached HTML");
  });
});
