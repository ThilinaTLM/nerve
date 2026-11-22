import assert from "node:assert/strict";
import { test } from "node:test";
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import { changeRows } from "./profile-changes";
import { changeSummary, type ChangeTextDeps } from "./profile-summary";

const deps: ChangeTextDeps = {
  modelName: (selection) => selection.modelId,
  permissionName: (id) => (id === "read_only" ? "Read only" : id),
  profileLabel: (name) => name,
};
const profile = (recommendations: object, instructions = "") =>
  profileDefinitionSchema.parse({
    schemaVersion: 1,
    name: "reviewer",
    whenToUse: "Use when reviewing",
    usableBy: "lead",
    instructions,
    recommendations,
  });

test("a profile without changes uses the defaults", () => {
  assert.equal(
    changeSummary(changeRows(profile({})), deps),
    "Uses your defaults",
  );
});

test("the summary names two changes and counts the rest", () => {
  const rows = changeRows(
    profile(
      {
        permissionRuleSetId: "read_only",
        tools: {
          plan_present: {
            enabled: true,
            settings: { approvalProfile: "coding" },
          },
          web_fetch: { enabled: false },
        },
      },
      "Be brief.",
    ),
  );
  assert.equal(
    changeSummary(rows, deps),
    "Permissions Read only · Web fetch Off · 2 more changes",
  );
});

test("instructions alone only count", () => {
  assert.equal(
    changeSummary(changeRows(profile({}, "Be brief.")), deps),
    "1 more change",
  );
});
