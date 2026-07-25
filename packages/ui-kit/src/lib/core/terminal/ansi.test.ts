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
