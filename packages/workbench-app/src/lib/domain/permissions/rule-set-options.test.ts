import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import {
  BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
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
  },
  {
    id: "disabled-coding",
    name: "Disabled coding",
    source: "user",
    enabled: false,
    available: true,
  },
  {
    id: "custom-planning",
    name: "Custom planning",
    source: "user",
    enabled: true,
    available: true,
  },
];

const summaries = [...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES, ...custom];

describe("permission rule-set options", () => {
  it("returns every enabled rule set except Baseline", () => {
    assert.deepEqual(
      selectablePermissionRuleSets(summaries).map(({ id }) => id),
      [
        "read_only",
        "supervised",
        "autonomous",
        "planning",
        "careful-coding",
        "custom-planning",
      ],
    );
  });

  it("preserves an unavailable selected ID instead of substituting Autonomous", () => {
    const selected = selectedPermissionRuleSetSummary(
      selectablePermissionRuleSets(summaries),
      "missing-custom",
    );
    assert.equal(selected.id, "missing-custom");
    assert.equal(selected.available, false);
  });
});
