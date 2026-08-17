import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { relativeEnvPath } from "../../src/harness/path-utils.js";

describe("execution environment path helpers", () => {
  it("compares Windows drive and UNC paths case-insensitively", () => {
    assert.equal(
      relativeEnvPath(
        String.raw`C:\Users\Alice\Skills`,
        String.raw`c:\users\alice\skills\Category\SKILL.md`,
      ),
      "Category/SKILL.md",
    );
    assert.equal(
      relativeEnvPath(
        String.raw`\\SERVER\Share\Skills`,
        String.raw`\\server\share\skills\Category\SKILL.md`,
      ),
      "Category/SKILL.md",
    );
  });

  it("does not confuse UNC sibling prefixes", () => {
    assert.equal(
      relativeEnvPath(
        String.raw`\\server\share\skills`,
        String.raw`\\server\share\skills-old\SKILL.md`,
      ),
      "server/share/skills-old/SKILL.md",
    );
  });

  it("keeps POSIX path comparisons case-sensitive", () => {
    assert.equal(
      relativeEnvPath("/Users/alice/skills", "/users/alice/skills/SKILL.md"),
      "users/alice/skills/SKILL.md",
    );
  });
});
