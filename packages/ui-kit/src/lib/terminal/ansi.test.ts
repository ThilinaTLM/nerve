import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ansiToHtml } from "./ansi";

describe("ansiToHtml", () => {
  it("escapes raw HTML text", () => {
    assert.equal(
      ansiToHtml('<script>alert("x")</script> & done'),
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; done",
    );
  });

  it("linkifies only HTTP(S) URLs when enabled", () => {
    const html = ansiToHtml(
      "Open http://127.0.0.1:5173/docs, https://example.test/a_(b). or file:///tmp/log",
      { linkifyUrls: true },
    );

    assert.equal(
      html,
      'Open <a href="http://127.0.0.1:5173/docs" target="_blank" rel="noopener noreferrer">http://127.0.0.1:5173/docs</a>, <a href="https://example.test/a_(b)" target="_blank" rel="noopener noreferrer">https://example.test/a_(b)</a>. or file:///tmp/log',
    );
    assert.equal(ansiToHtml("https://example.test"), "https://example.test");
  });

  it("escapes link text and attributes", () => {
    const html = ansiToHtml(
      "https://example.test/search?a=1&b=2 <script>alert(1)</script>",
      { linkifyUrls: true },
    );

    assert.equal(
      html,
      '<a href="https://example.test/search?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://example.test/search?a=1&amp;b=2</a> &lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it("preserves ANSI styling around linked URLs", () => {
    const html = ansiToHtml("\x1b[36mhttps://example.test\x1b[39m", {
      linkifyUrls: true,
    });

    assert.equal(
      html,
      '<a href="https://example.test" target="_blank" rel="noopener noreferrer"><span class="ansi-fg-cyan">https://example.test</span></a>',
    );
  });

  it("keeps one complete URL target across ANSI style changes", () => {
    const html = ansiToHtml(
      "\x1b[36mhttp://127.0.0.1:\x1b[1m5173\x1b[22m/\x1b[39m",
      { linkifyUrls: true },
    );

    assert.equal(
      html,
      '<a href="http://127.0.0.1:5173/" target="_blank" rel="noopener noreferrer"><span class="ansi-fg-cyan">http://127.0.0.1:</span><span class="ansi-bold ansi-fg-cyan">5173</span><span class="ansi-fg-cyan">/</span></a>',
    );
  });

  it("renders common SGR colors and styles without raw escapes", () => {
    const html = ansiToHtml("\x1b[2m10:49 AM\x1b[22m \x1b[32mready\x1b[39m");

    assert.equal(html.includes("\x1b"), false);
    assert.match(html, /class="ansi-dim"/);
    assert.match(html, /class="ansi-fg-green"/);
    assert.match(html, />ready<\/span>/);
  });

  it("strips unsupported CSI and OSC controls", () => {
    const html = ansiToHtml("a\x1b[2Kb\x1b]0;title\x07c\x1b[31md");

    assert.equal(html.includes("\x1b"), false);
    assert.equal(html.includes("title"), false);
    assert.match(html, /^ab(?:c)<span class="ansi-fg-red">d<\/span>$/);
  });
});
