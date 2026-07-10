import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiPathSegment, normalizeApiPathForFetch } from "./client";

describe("API client path helpers", () => {
  it("accepts same-origin API paths", () => {
    assert.equal(normalizeApiPathForFetch("/api/projects"), "/api/projects");
    assert.equal(
      normalizeApiPathForFetch("/api/projects?limit=1"),
      "/api/projects?limit=1",
    );
  });

  it("rejects external and non-API paths", () => {
    for (const path of [
      "https://evil.test/api/projects",
      "//evil.test/api/projects",
      "/settings",
      "/api/../settings",
    ]) {
      assert.throws(() => normalizeApiPathForFetch(path), /API requests/);
    }
  });

  it("encodes dynamic path segments", () => {
    assert.equal(apiPathSegment("../x/y?z"), "..%2Fx%2Fy%3Fz");
    assert.equal(apiPathSegment(42), "42");
    assert.throws(() => apiPathSegment(Number.NaN), /finite number/);
  });
});
