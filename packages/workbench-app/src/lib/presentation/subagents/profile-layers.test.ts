import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubagentProfileConfiguration } from "@nervekit/contracts/subagents";
import {
  profileCreatedHere,
  profileCustomizedFields,
  profileOriginLayer,
  profileSummaryParts,
} from "./profile-layers";

function configuration(
  fields: SubagentProfileConfiguration["origins"]["fields"],
  local: SubagentProfileConfiguration["local"] = null,
): SubagentProfileConfiguration {
  return {
    name: "explore",
    local,
    inherited: null,
    effective: null,
    origins: { fields, tools: {}, skills: {} },
    trust: "trusted",
    diagnostics: [],
  };
}

test("the origin layer is the lowest layer contributing a field", () => {
  const customized = configuration(
    { description: "builtin", model: "project", thinking: "user" },
    { model: "openai/gpt-5-mini" },
  );
  assert.equal(profileOriginLayer(customized, "project"), "builtin");
  assert.equal(profileCreatedHere(customized, "project"), false);
  assert.deepEqual(profileCustomizedFields(customized, "project"), ["model"]);

  const created = configuration(
    { description: "project", model: "project" },
    { description: "Reviews", model: "lead" },
  );
  assert.equal(profileCreatedHere(created, "project"), true);
  assert.deepEqual(profileCustomizedFields(created, "project"), []);
});

test("profiles without parsed fields belong to the scope being edited", () => {
  assert.equal(profileOriginLayer(configuration({}), "user"), "user");
});

test("the summary lists only differences from the lead", () => {
  assert.deepEqual(
    profileSummaryParts(
      {
        name: "reviewer",
        label: "Reviewer",
        description: "Reviews",
        enabled: true,
        source: "user",
        model: "lead",
        thinking: "high",
        permission: "read_only",
        compaction: "inherit",
        tools: { jira: true, web_search: false, web_fetch: false },
        skills: "none",
        instructions: "",
      },
      [],
    ),
    [
      "Same as lead",
      "High thinking",
      "Read-only",
      "+Jira",
      "−Web access",
      "No skills",
    ],
  );
});
