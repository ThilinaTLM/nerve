import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slugifyBranch } from "../src/utility-llm-service.js";

describe("slugifyBranch", () => {
  it("kebab-cases and lowercases", () => {
    assert.equal(slugifyBranch("Add Login Page"), "add-login-page");
  });

  it("preserves type prefixes with slash", () => {
    assert.equal(slugifyBranch("feat/User Auth"), "feat/user-auth");
  });

  it("strips list markers and surrounding noise", () => {
    assert.equal(slugifyBranch("1. fix-bug"), "fix-bug");
    assert.equal(slugifyBranch("- chore/cleanup"), "chore/cleanup");
  });

  it("removes invalid characters and collapses dashes", () => {
    assert.equal(
      slugifyBranch("feature: add `thing` (v2)!!"),
      "feature-add-thing-v2",
    );
  });

  it("trims leading and trailing separators", () => {
    assert.equal(slugifyBranch("/feature/x/"), "feature/x");
  });

  it("caps length at 60 characters", () => {
    const long = `feat/${"a".repeat(100)}`;
    assert.ok(slugifyBranch(long).length <= 60);
  });
});
