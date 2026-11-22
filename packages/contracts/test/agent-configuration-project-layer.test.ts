import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentConfiguration } from "../src/domains/agent-configuration/resolver.js";

const model = { provider: "p", modelId: "a" };

void test("a project toggles tools, skills and sub-agents against the user and the built-in defaults", () => {
  const resolved = resolveAgentConfiguration({
    role: "lead",
    subagentDefaults: { explore: true, review: false },
    eligibleSkills: { nerve: ["docs", "qa"], file: ["mine"] },
    user: {
      model,
      tools: { web_search: { enabled: false } },
      skills: { nerve: { docs: false }, defaults: { file: false } },
      subagents: { explore: { enabled: false } },
    },
    project: {
      tools: { web_search: { enabled: true }, plan_present: { enabled: true } },
      skills: { nerve: { docs: true, qa: false }, file: { mine: true } },
      subagents: { explore: { enabled: true }, review: { enabled: true } },
    },
  });
  const { settings, provenance } = resolved;
  // Re-enabled in the project what the user turned off.
  assert.equal(settings.tools?.web_search?.enabled, true);
  assert.equal(provenance["/tools/web_search/enabled"].source, "project");
  // A built-in default (off) turned on in the project.
  assert.equal(settings.tools?.plan_present?.enabled, true);
  assert.equal(settings.skills?.nerve?.docs, true);
  assert.equal(settings.skills?.nerve?.qa, false);
  assert.equal(settings.skills?.file?.mine, true);
  assert.equal(provenance["/skills/file/mine"].source, "project");
  assert.equal(settings.subagents?.explore?.enabled, true);
  assert.equal(settings.subagents?.review?.enabled, true);
  assert.equal(provenance["/subagents/review/enabled"].source, "project");
});

void test("without a project value the user's choice, then the built-in default, applies", () => {
  const resolved = resolveAgentConfiguration({
    role: "lead",
    subagentDefaults: { explore: true, review: false },
    eligibleSkills: { file: ["mine"] },
    user: {
      model,
      skills: { defaults: { file: false } },
      subagents: { explore: { enabled: false } },
    },
    project: {},
  });
  assert.equal(resolved.settings.skills?.file?.mine, false);
  assert.equal(resolved.settings.subagents?.explore?.enabled, false);
  assert.equal(resolved.settings.subagents?.review?.enabled, false);
  assert.equal(
    resolved.provenance["/subagents/review/enabled"].source,
    "builtin",
  );
});
