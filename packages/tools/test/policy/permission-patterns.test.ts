import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pathGlobMatches,
  patternMatches,
  validateCommandGlob,
  validatePathGlob,
  validateUrlGlob,
} from "../../src/index.js";

describe("permission exception patterns", () => {
  it("accepts project-relative POSIX globs and rejects traversal or platform-specific absolute paths", () => {
    assert.equal(validatePathGlob("secrets/**"), undefined);
    assert.equal(pathGlobMatches("secrets/api/key.txt", "secrets/**"), true);
    assert.match(validatePathGlob("../secrets/**") ?? "", /outside/);
    assert.match(validatePathGlob("C:\\secrets\\**") ?? "", /forward slashes/);
    assert.match(validatePathGlob("/etc/**") ?? "", /relative/);
  });

  it("matches normalized command globs", () => {
    assert.equal(validateCommandGlob("pnpm test*"), undefined);
    assert.equal(
      patternMatches("pnpm test --filter tools", "pnpm test*"),
      true,
    );
    assert.equal(patternMatches("pnpm fix", "pnpm test*"), false);
    assert.match(validateCommandGlob("*") ?? "", /focused/);
  });

  it("matches URL globs across normalized full URLs", () => {
    assert.equal(validateUrlGlob("https://*.example.com/**"), undefined);
    assert.equal(
      patternMatches(
        "https://docs.example.com/guide/start",
        "https://*.example.com/**",
      ),
      true,
    );
    assert.equal(
      patternMatches("https://example.com/guide", "https://*.example.com/**"),
      false,
    );
    assert.match(validateUrlGlob("*.example.com/**") ?? "", /scheme/);
  });
});
