import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyNavigationTarget } from "../src/window/navigation-guards.js";

const daemonUrl = "http://127.0.0.1:3747";

describe("classifyNavigationTarget", () => {
  it("allows only the daemon application root", () => {
    assert.equal(classifyNavigationTarget(daemonUrl, daemonUrl), "daemon-root");
    assert.equal(
      classifyNavigationTarget(`${daemonUrl}/?zoom=1#workspace`, daemonUrl),
      "daemon-root",
    );
    assert.equal(
      classifyNavigationTarget(`${daemonUrl}/LICENSE`, daemonUrl),
      "blocked",
    );
    assert.equal(
      classifyNavigationTarget(`${daemonUrl}/settings`, daemonUrl),
      "blocked",
    );
  });

  it("opens safe cross-origin web URLs externally", () => {
    assert.equal(
      classifyNavigationTarget("https://example.test/docs", daemonUrl),
      "external",
    );
    assert.equal(
      classifyNavigationTarget("http://example.test/docs", daemonUrl),
      "external",
    );
    assert.equal(
      classifyNavigationTarget("https://example.test/docs", undefined),
      "external",
    );
  });

  it("blocks malformed URLs and unsafe protocols", () => {
    for (const url of [
      "LICENSE",
      "not a URL",
      "file:///tmp/README.md",
      "data:text/html,hello",
      "javascript:alert(1)",
    ]) {
      assert.equal(classifyNavigationTarget(url, daemonUrl), "blocked", url);
    }
  });
});
