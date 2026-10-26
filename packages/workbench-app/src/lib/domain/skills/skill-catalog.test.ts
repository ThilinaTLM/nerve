import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterSkills,
  sourcesForScope,
  summarizeSkills,
  type SkillEntry,
} from "./skill-catalog.js";

describe("sourcesForScope", () => {
  it("keeps project-directory skills out of machine-wide user settings", () => {
    assert.deepEqual(sourcesForScope("user"), [
      "user",
      "nerve",
      "agentBrowser",
    ]);
    assert.deepEqual(sourcesForScope("project"), [
      "user",
      "project",
      "nerve",
      "agentBrowser",
    ]);
  });
});

describe("filterSkills and summarizeSkills", () => {
  it("matches names and descriptions case-insensitively and summarizes effective enablement", () => {
    const entries: SkillEntry[] = ["deploy", "review"].map((name, index) => ({
      skill: {
        name,
        description: `${name} description`,
        source: "project",
        filePath: `/${name}/SKILL.md`,
      },
      source: "project",
      kind: "file",
      enabled: index === 0,
      overridden: false,
      inherited: false,
    }));
    assert.deepEqual(filterSkills({ entries, query: "DEPLOY" }), [entries[0]]);
    assert.deepEqual(filterSkills({ entries, query: "description" }), entries);
    assert.deepEqual(filterSkills({ entries }), entries);
    assert.deepEqual(summarizeSkills(entries), { total: 2, enabled: 1 });
  });
});
