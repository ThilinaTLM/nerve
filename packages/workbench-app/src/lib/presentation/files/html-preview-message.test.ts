import { strict as assert } from "node:assert";
import { it } from "node:test";
import {
  htmlPreviewResourceCandidate,
  isHtmlPreviewResourceMessage,
} from "./html-preview-message.js";
const app = "https://app.example";
const message = (url: string, category = "script") => ({
  type: "nerve:html-preview-resource",
  category,
  url,
});
it("requires the actual frame source and a validated resource payload", () => {
  const frame = {};
  const data = message("https://cdn.example/a.js");
  assert.equal(
    isHtmlPreviewResourceMessage({ source: frame, data }, frame, app),
    true,
  );
  assert.equal(
    isHtmlPreviewResourceMessage({ source: {}, data }, frame, app),
    false,
  );
  assert.equal(
    isHtmlPreviewResourceMessage({ source: null, data }, null, app),
    false,
  );
  assert.equal(
    isHtmlPreviewResourceMessage(
      { source: frame, data: { ...data, category: "connect" } },
      frame,
      app,
    ),
    false,
  );
});
it("normalizes exact origins and rejects app origin, non-HTTP, credentials and malformed URLs", () => {
  assert.deepEqual(
    htmlPreviewResourceCandidate(
      message("https://CDN.example:443/path?q=1", "font"),
      app,
    ),
    { origin: "https://cdn.example", category: "font" },
  );
  for (const url of [
    app + "/api",
    "https://user:pass@cdn.example/x",
    "data:text/html,test",
    "file:///tmp/a",
    "/relative",
    "//cdn.example/a",
    "not a URL",
    "https://cdn.example/" + "a".repeat(4096),
  ]) {
    assert.equal(
      htmlPreviewResourceCandidate(message(url), app),
      undefined,
      url,
    );
  }
  assert.equal(htmlPreviewResourceCandidate(null, app), undefined);
  assert.equal(
    htmlPreviewResourceCandidate(
      { ...message("https://cdn.example"), type: "unknown" },
      app,
    ),
    undefined,
  );
});
