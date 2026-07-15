import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadingHtml } from "../src/window/loading-pages.ts";

describe("desktop loading page", () => {
  it("renders the welcome-style Nerve startup signal", () => {
    const html = loadingHtml();

    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-labelledby="loading-title"/);
    assert.match(
      html,
      /<h1 id="loading-title" class="loading-title">Getting things ready<\/h1>/,
    );
    assert.match(html, /class="signal-orbit"/);
    assert.match(html, /class="signal-mark"/);
    assert.match(html, /M150 162L222 226L246 194L272 300L296 262L362 350/);
    assert.match(
      html,
      /<p class="status" role="status" aria-live="polite">Starting local daemon…<\/p>/,
    );
  });

  it("escapes a custom daemon status", () => {
    const html = loadingHtml('Starting <script>alert("no")</script> & waiting');

    assert.match(
      html,
      /Starting &lt;script&gt;alert\(&quot;no&quot;\)&lt;\/script&gt; &amp; waiting/,
    );
    assert.doesNotMatch(html, /<script>alert/);
  });

  it("stops the decorative orbit when reduced motion is requested", () => {
    const html = loadingHtml();

    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /\.signal-orbit \{ animation: none; \}/);
  });
});
