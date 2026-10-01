import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimTrailingSlashes } from "../../src/execution/atlassian/site-url.js";

describe("trimTrailingSlashes", () => {
  it("removes only trailing slashes", () => {
    assert.equal(
      trimTrailingSlashes("https://a.atlassian.net//"),
      "https://a.atlassian.net",
    );
    assert.equal(trimTrailingSlashes("///"), "");
    assert.equal(trimTrailingSlashes("https://a/x"), "https://a/x");
  });
});
