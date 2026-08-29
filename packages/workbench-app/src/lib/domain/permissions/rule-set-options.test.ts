import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PermissionRuleSetSummary } from "@nervekit/contracts";
import {
  BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
  effectivePermissionRuleSetId,
  legacyPermissionLevelForRuleSet,
  selectablePermissionRuleSets,
  selectedPermissionRuleSetSummary,
} from "./rule-set-options";

const custom: PermissionRuleSetSummary[] = [
  {
    id: "careful-coding",
    name: "Careful coding",
    source: "user",
    enabled: true,
    available: true,
    compatibleModes: ["coding"],
  },
  {
    id: "disabled-coding",
    name: "Disabled coding",
    source: "user",
    enabled: false,
    available: true,
    compatibleModes: ["coding"],
  },
  {
    id: "custom-planning",
    name: "Custom planning",
    source: "user",
    enabled: true,
    available: true,
    compatibleModes: ["planning"],
  },
];

const summaries = [...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES, ...custom];

describe("permission rule-set options", () => {
  it("returns coding built-ins and enabled compatible user sets", () => {
    assert.deepEqual(
      selectablePermissionRuleSets(summaries, "coding").map(({ id }) => id),
      ["read_only", "supervised", "autonomous", "careful-coding"],
    );
  });

  it("returns only the fixed Planning rule set in planning mode", () => {
    assert.deepEqual(
      selectablePermissionRuleSets(summaries, "planning").map(({ id }) => id),
      ["planning"],
    );
    assert.equal(
      effectivePermissionRuleSetId("careful-coding", "planning"),
      "planning",
    );
    assert.equal(
      effectivePermissionRuleSetId("careful-coding", "coding"),
      "careful-coding",
    );
  });

  it("preserves an unavailable selected ID instead of substituting Autonomous", () => {
    const selected = selectedPermissionRuleSetSummary(
      selectablePermissionRuleSets(summaries, "coding"),
      "missing-custom",
    );
    assert.equal(selected.id, "missing-custom");
    assert.equal(selected.available, false);
  });

  it("mirrors only legacy coding built-ins into permissionLevel", () => {
    assert.equal(legacyPermissionLevelForRuleSet("supervised"), "supervised");
    assert.equal(legacyPermissionLevelForRuleSet("careful-coding"), undefined);
    assert.equal(legacyPermissionLevelForRuleSet("planning"), undefined);
  });
});
