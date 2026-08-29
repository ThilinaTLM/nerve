import type { AvailableSkill } from "@nervekit/contracts/skills";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSkillEntries,
  bulkSkillSets,
  filterSkills,
  summarizeSkills,
} from "./skills-filter.js";

const skill = (name: string): AvailableSkill => ({
  name,
  description: `${name} description`,
  filePath: `/skills/${name}/SKILL.md`,
});

const input = {
  agentBrowserSkills: [skill("core"), skill("dogfood")],
  globalSkills: [skill("review"), skill("shared")],
  projectSkills: [skill("shared"), skill("deploy")],
  sets: { disabled: ["review"], agentBrowserEnabled: ["core"] },
};

describe("buildSkillEntries", () => {
  it("derives enabled state from the correct persisted set per source", () => {
    const entries = buildSkillEntries(input);
    const byKey = new Map(
      entries.map((entry) => [`${entry.source}:${entry.skill.name}`, entry]),
    );

    assert.equal(byKey.get("agentBrowser:core")?.enabled, true);
    assert.equal(byKey.get("agentBrowser:dogfood")?.enabled, false);
    assert.equal(byKey.get("global:review")?.enabled, false);
    assert.equal(byKey.get("global:shared")?.enabled, true);
    assert.equal(byKey.get("project:deploy")?.enabled, true);
  });

  it("flags overrides in both directions", () => {
    const entries = buildSkillEntries(input);
    const globalShared = entries.find(
      (entry) => entry.source === "global" && entry.skill.name === "shared",
    );
    const globalReview = entries.find(
      (entry) => entry.source === "global" && entry.skill.name === "review",
    );

    assert.equal(globalShared?.overrideNote, "Project overrides global");
    assert.equal(globalReview?.overrideNote, undefined);
  });

  it("marks agent-browser skills shadowed by a file skill", () => {
    const entries = buildSkillEntries({
      ...input,
      agentBrowserSkills: [skill("shared")],
    });
    assert.equal(entries[0].overrideNote, "File skill takes precedence");
  });
});

describe("filterSkills", () => {
  it("matches name and description case-insensitively", () => {
    const entries = buildSkillEntries(input);
    assert.deepEqual(
      filterSkills({ entries, query: "DEPLOY" }).map(
        (entry) => entry.skill.name,
      ),
      ["deploy"],
    );
    assert.equal(
      filterSkills({ entries, query: "description" }).length,
      entries.length,
    );
  });

  it("returns everything when no query is set", () => {
    const entries = buildSkillEntries(input);
    assert.equal(filterSkills({ entries }).length, entries.length);
  });
});

describe("summarizeSkills", () => {
  it("counts enabled entries in the given set", () => {
    const entries = buildSkillEntries(input);
    assert.deepEqual(summarizeSkills(entries), { total: 6, enabled: 4 });
    assert.deepEqual(
      summarizeSkills(
        entries.filter((entry) => entry.source === "agentBrowser"),
      ),
      { total: 2, enabled: 1 },
    );
  });
});

describe("bulkSkillSets", () => {
  it("updates both source families in one patch and keeps names outside the set", () => {
    const entries = buildSkillEntries(input);
    const filtered = entries.filter((entry) =>
      ["core", "dogfood", "deploy"].includes(entry.skill.name),
    );
    const next = bulkSkillSets({
      entries: filtered,
      enabled: false,
      sets: input.sets,
    });

    // "shared" is outside the filtered set, so it keeps its enabled state.
    assert.deepEqual(next.agentBrowserEnabled, []);
    assert.deepEqual(next.disabled, ["deploy", "review"]);
  });

  it("enabling clears the disabled set and adds agent-browser names", () => {
    const entries = buildSkillEntries(input);
    const next = bulkSkillSets({ entries, enabled: true, sets: input.sets });

    assert.deepEqual(next.disabled, []);
    assert.deepEqual(next.agentBrowserEnabled, ["core", "dogfood"]);
  });

  it("deduplicates names shared by global and project sources", () => {
    const entries = buildSkillEntries(input);
    const shared = entries.filter((entry) => entry.skill.name === "shared");
    assert.equal(shared.length, 2);

    const next = bulkSkillSets({
      entries: shared,
      enabled: false,
      sets: { disabled: [], agentBrowserEnabled: [] },
    });
    assert.deepEqual(next.disabled, ["shared"]);
  });
});
