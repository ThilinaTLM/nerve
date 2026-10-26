import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReleasedSkills } from "./released-resources.js";
import { splitCatalogV037 } from "./released-format.js";
import baseline from "./released-baseline.json" with { type: "json" };

await test("released discovery preserves overlapping source identities and unavailable explicitly sourced choices", () => {
  const sources = classifyReleasedSkills(
    [
      { name: "shared", source: "file" },
      { name: "shared", source: "agentBrowser" },
    ],
    [{ capabilities: { skills: { nerve: { missing: false } } } }],
  );
  assert.deepEqual(sources.shared, ["file", "agentBrowser"]);
  assert.deepEqual(sources.missing, ["nerve"]);
  const report: string[] = [];
  const ctx = {
    builtins: Object.fromEntries(
      baseline.builtins.map((profile) => [profile.name, profile]),
    ),
    skillSources: sources,
    report: (message: string) => report.push(message),
  };
  const result = splitCatalogV037(
    { schemaVersion: 1, profiles: { developer: { skills: { shared: true } } } },
    "user",
    ctx,
  );
  assert.deepEqual(result.profiles.developer.recommendations.skills, {
    file: { shared: true },
    agentBrowser: { shared: true },
  });
  assert.throws(
    () =>
      splitCatalogV037(
        {
          schemaVersion: 1,
          profiles: { developer: { skills: { unmappable: true } } },
        },
        "project",
        ctx,
      ),
    /source identity/,
  );
  assert(
    report.some(
      (message) =>
        message.includes("Unmappable") && message.includes("unmappable"),
    ),
  );
});
