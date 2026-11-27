import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  decorateMarkdownHtml,
  getHighlightedMarkdownSync,
  renderDecoratedMarkdown,
  renderHighlightedMarkdown,
  renderMarkdown,
} from "./markdown-render";
import { isMermaidLanguage } from "../mermaid/mermaid-render";

// Note: `decorateMarkdownHtml`/`highlightMarkdownHtml` short-circuit without a
// DOM (`typeof document === "undefined"`), so under the Node test runner the
// decorated/highlighted products equal the raw parse output. These tests assert
// caching semantics (reference identity / promise de-duplication), which hold
// regardless of the DOM-dependent decoration.

describe("Mermaid fence detection", () => {
  it("matches only the Mermaid language name", () => {
    assert.equal(isMermaidLanguage("mermaid"), true);
    assert.equal(isMermaidLanguage(" Mermaid "), true);
    assert.equal(isMermaidLanguage("MERMAID"), true);
    assert.equal(isMermaidLanguage("mermaid-js"), false);
    assert.equal(isMermaidLanguage(undefined), false);
  });
});

describe("Markdown line breaks", () => {
  it("preserves soft line endings only when requested", () => {
    const source = `first line ${Math.random()}\nsecond line`;
    const standard = renderDecoratedMarkdown(source, true);
    const preserved = renderDecoratedMarkdown(source, true, {
      preserveLineBreaks: true,
    });

    assert.doesNotMatch(standard, /<br\s*\/?\s*>/);
    assert.match(preserved, /<br\s*\/?\s*>/);
    assert.notEqual(
      standard,
      preserved,
      "render caches remain isolated by line-break mode",
    );
  });
});

describe("Markdown frontmatter", () => {
  const skill =
    "---\nname: demo\ndescription: Use <when> needed\ntags: [a, b]\n---\n\n# Title\n";

  it("renders flat frontmatter as a key/value table when enabled", () => {
    const html = renderMarkdown(skill, { cache: false, frontmatter: true });
    assert.ok(html.startsWith('<table class="frontmatter"><tbody>'));
    assert.ok(html.includes('<tr><th scope="row">name</th><td>demo</td></tr>'));
    assert.ok(html.includes("<td>Use &#x3C;when> needed</td>"));
    assert.ok(html.includes('<th scope="row">tags</th><td>a, b</td>'));
    assert.ok(html.includes("<h1>Title</h1>"));
    assert.doesNotMatch(html, /<hr>|<h2>|<thead>/);
  });

  it("falls back to a yaml code block for nested or invalid metadata", () => {
    for (const meta of ["a:\n  b: 1", "a: ["]) {
      const html = renderMarkdown(`---\n${meta}\n---\nbody`, {
        cache: false,
        frontmatter: true,
      });
      assert.ok(html.startsWith('<pre><code class="language-yaml">'), html);
    }
  });

  it("leaves leading rules untouched unless enabled", () => {
    const html = renderMarkdown(skill, { cache: false });
    assert.ok(html.startsWith("<hr>"));
  });
});

describe("Markdown images", () => {
  it("preserves HTTPS image URLs through sanitization", () => {
    const imageUrl =
      "https://github.com/ThilinaTLM/nerve/actions/workflows/ci.yml/badge.svg";
    const html = renderMarkdown(`[![CI](${imageUrl})](${imageUrl})`, {
      cache: false,
    });

    assert.ok(html.includes(`<img src="${imageUrl}" alt="CI">`));
  });
});

describe("markdown-render caching", () => {
  it("keeps streaming cache bypass output equivalent to finalized decoration", () => {
    const source = `streaming ${Math.random()} with **markdown**`;
    const streaming = decorateMarkdownHtml(
      renderMarkdown(source, { cache: false }),
      true,
    );
    const finalized = renderDecoratedMarkdown(source, true);
    assert.equal(streaming, finalized);
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
