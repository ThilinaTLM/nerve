import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pathGlobMatches,
  validatePathGlob,
  validateWebHostPattern,
  webHostMatches,
} from "../src/index.js";

describe("permission exception patterns", () => {
  it("accepts project-relative POSIX globs and rejects traversal or platform-specific absolute paths", () => {
    assert.equal(validatePathGlob("secrets/**"), undefined);
    assert.equal(pathGlobMatches("secrets/api/key.txt", "secrets/**"), true);
    assert.match(validatePathGlob("../secrets/**") ?? "", /outside/);
    assert.match(validatePathGlob("C:\\secrets\\**") ?? "", /forward slashes/);
    assert.match(validatePathGlob("/etc/**") ?? "", /relative/);
  });

  it("matches exact hosts and leading-wildcard subdomains only", () => {
    assert.equal(validateWebHostPattern("*.example.com"), undefined);
    assert.equal(webHostMatches("api.example.com", "*.example.com"), true);
    assert.equal(webHostMatches("example.com", "*.example.com"), false);
    assert.equal(webHostMatches("other.example.net", "*.example.com"), false);
    assert.equal(webHostMatches("example.com", "example.com"), true);
    assert.match(validateWebHostPattern("*.*.example.com") ?? "", /hostname/);
  });
});
