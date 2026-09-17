import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CapabilityOverridesDocument,
  CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type { AvailableSkill, SkillSource } from "@nervekit/contracts/skills";
import {
  buildSkillEntries,
  bulkSkillSets,
  composerSkillRows,
  filterSkills,
  orphanedSkills,
  sourcesForScope,
  summarizeSkills,
} from "./skill-catalog.js";

const skill = (name: string, source: SkillSource): AvailableSkill => ({
  name,
  description: `${name} description`,
  filePath: `/${source}/${name}/SKILL.md`,
  source,
});

const skills = [
  skill("deploy", "project"),
  skill("shared", "project"),
  skill("review", "user"),
  skill("shared", "user"),
  skill("core", "agentBrowser"),
  skill("dogfood", "agentBrowser"),
];

const sets = { disabled: ["review"], agentBrowserEnabled: ["core"] };

const overrides = (
  document: Partial<CapabilityOverridesDocument["skills"]>,
): CapabilityOverridesDocument => ({
  schemaVersion: 1,
  tools: {},
  skills: { file: {}, agentBrowser: {}, ...document },
});

describe("sourcesForScope", () => {
  it("keeps project-directory skills out of machine-wide user settings", () => {
    assert.deepEqual(sourcesForScope("user"), ["user", "agentBrowser"]);
    assert.deepEqual(sourcesForScope("project"), [
      "user",
      "project",
      "agentBrowser",
    ]);
  });
});

describe("buildSkillEntries", () => {
  it("derives user scope state from the persisted sets and hides project skills", () => {
    const entries = buildSkillEntries({ skills, scope: "user", sets });
    const byKey = new Map(
      entries.map((entry) => [`${entry.source}:${entry.skill.name}`, entry]),
    );

    assert.equal(
      entries.some((entry) => entry.source === "project"),
      false,
    );
    assert.equal(byKey.get("user:review")?.enabled, false);
    assert.equal(byKey.get("user:shared")?.enabled, true);
    assert.equal(byKey.get("agentBrowser:core")?.enabled, true);
    assert.equal(byKey.get("agentBrowser:dogfood")?.enabled, false);
  });

  it("layers project overrides over inherited user defaults", () => {
    const entries = buildSkillEntries({
      skills,
      scope: "project",
      sets,
      project: overrides({ file: { review: true, deploy: false } }),
    });
    const byKey = new Map(
      entries.map((entry) => [`${entry.source}:${entry.skill.name}`, entry]),
    );

    const review = byKey.get("user:review");
    assert.equal(review?.enabled, true);
    assert.equal(review?.overridden, true);
    assert.equal(review?.inherited, false);

    const deploy = byKey.get("project:deploy");
    assert.equal(deploy?.enabled, false);
    assert.equal(deploy?.overridden, true);

    const shared = byKey.get("project:shared");
    assert.equal(shared?.overridden, false);
    assert.equal(shared?.enabled, true);
  });

  it("marks rows shadowed by a higher precedence definition", () => {
    const entries = buildSkillEntries({
      skills: [...skills, skill("shared", "agentBrowser")],
      scope: "project",
      sets,
    });
    const shadowed = entries.filter((entry) => entry.shadowedBy !== undefined);
    assert.deepEqual(
      shadowed.map((entry) => `${entry.source}:${entry.skill.name}`),
      ["user:shared", "agentBrowser:shared"],
    );
  });
});

describe("orphanedSkills", () => {
  it("surfaces stored names that match no discovered skill in the scope", () => {
    assert.deepEqual(
      orphanedSkills({
        skills,
        scope: "user",
        sets: { disabled: ["review", "deploy"], agentBrowserEnabled: ["gone"] },
      }),
      [
        { name: "deploy", kind: "file", enabled: false },
        { name: "gone", kind: "agentBrowser", enabled: true },
      ],
    );
  });

  it("surfaces project overrides for removed skills", () => {
    assert.deepEqual(
      orphanedSkills({
        skills,
        scope: "project",
        sets,
        overrides: overrides({ file: { deploy: false, removed: false } }),
      }),
      [{ name: "removed", kind: "file", enabled: false }],
    );
  });
});

describe("filterSkills and summarizeSkills", () => {
  it("matches name and description case-insensitively", () => {
    const entries = buildSkillEntries({ skills, scope: "project", sets });
    assert.deepEqual(
      filterSkills({ entries, query: "DEPLOY" }).map(
        (entry) => entry.skill.name,
      ),
      ["deploy"],
    );
    assert.equal(filterSkills({ entries }).length, entries.length);
    assert.deepEqual(summarizeSkills(entries), { total: 6, enabled: 4 });
  });
});

describe("bulkSkillSets", () => {
  it("updates both families and keeps names outside the selection", () => {
    const entries = buildSkillEntries({ skills, scope: "project", sets });
    const next = bulkSkillSets({
      entries: entries.filter((entry) =>
        ["core", "dogfood", "deploy"].includes(entry.skill.name),
      ),
      enabled: false,
      sets,
    });

    assert.deepEqual(next.agentBrowserEnabled, []);
    assert.deepEqual(next.disabled, ["deploy", "review"]);
  });
});

describe("composerSkillRows", () => {
  const selection: CapabilitySelection = {
    disabledTools: [],
    disabledFileSkills: ["review"],
    enabledAgentBrowserSkills: ["core"],
  };

  it("keeps same-named file and agent browser skills as separate rows", () => {
    const rows = composerSkillRows({
      skills: [skill("core", "project"), skill("core", "agentBrowser")],
      selection,
    });
    assert.deepEqual(
      rows.map((row) => [row.key, row.enabled]),
      [
        ["file:core", true],
        ["agentBrowser:core", true],
      ],
    );
  });

  it("collapses file skills project-over-user like the runtime does", () => {
    const rows = composerSkillRows({ skills, selection });
    assert.deepEqual(
      rows.map((row) => `${row.source}:${row.name}`),
      [
        "project:deploy",
        "project:shared",
        "user:review",
        "agentBrowser:core",
        "agentBrowser:dogfood",
      ],
    );
    assert.equal(rows.find((row) => row.name === "review")?.enabled, false);
  });

  it("reports conversation overrides and the inherited origin", () => {
    const rows = composerSkillRows({
      skills,
      selection,
      project: overrides({ file: { deploy: false } }),
      conversation: overrides({ agentBrowser: { dogfood: true } }),
    });
    const byName = new Map(rows.map((row) => [row.name, row]));
    assert.equal(byName.get("dogfood")?.overridden, true);
    assert.equal(byName.get("deploy")?.inheritedFrom, "project");
    assert.equal(byName.get("review")?.inheritedFrom, "user");
  });
});
