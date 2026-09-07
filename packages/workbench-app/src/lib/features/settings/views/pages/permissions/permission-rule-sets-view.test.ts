import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PermissionPolicyConfiguration,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import {
  isDefaultEligible,
  overlaySummary,
  ruleSetRole,
} from "./permission-rule-sets-view";

function ruleSet(
  overrides: Partial<PermissionRuleSetSummary> & { id: string },
): PermissionRuleSetSummary {
  return {
    name: overrides.id,
    source: "builtin",
    enabled: true,
    available: true,
    compatibleModes: ["coding"],
    ...overrides,
  } as PermissionRuleSetSummary;
}

function configuration(
  projectRuleCounts: Record<string, number>,
  userRuleCounts: Record<string, number>,
): PermissionPolicyConfiguration {
  const document = (counts: Record<string, number>) => ({
    schemaVersion: 2 as const,
    overlays: Object.entries(counts).map(([ruleSetId, count]) => ({
      ruleSetId,
      rules: Array.from({ length: count }, (_, index) => ({
        id: `${ruleSetId}-${index}`,
      })),
    })),
  });
  return {
    projectOverlays: document(projectRuleCounts),
    userOverlays: document(userRuleCounts),
  } as unknown as PermissionPolicyConfiguration;
}

describe("permission rule set view helpers", () => {
  it("offers the coding rule sets as default choices", () => {
    for (const id of ["read_only", "supervised", "autonomous"]) {
      assert.equal(isDefaultEligible(ruleSet({ id })), true, id);
    }
  });

  it("never offers baseline or planning as the default", () => {
    // Baseline is always applied underneath, and planning is forced by the mode.
    assert.equal(isDefaultEligible(ruleSet({ id: "baseline" })), false);
    assert.equal(
      isDefaultEligible(
        ruleSet({ id: "planning", compatibleModes: ["planning"] }),
      ),
      false,
    );
  });

  it("rejects rule sets that cannot currently be applied", () => {
    assert.equal(
      isDefaultEligible(ruleSet({ id: "supervised", enabled: false })),
      false,
    );
    assert.equal(
      isDefaultEligible(ruleSet({ id: "supervised", available: false })),
      false,
    );
    assert.equal(
      isDefaultEligible(
        ruleSet({ id: "custom", compatibleModes: ["planning"] }),
      ),
      false,
    );
  });

  it("accepts a user rule set that does not restrict its modes", () => {
    assert.equal(
      isDefaultEligible(
        ruleSet({ id: "custom", source: "user", compatibleModes: undefined }),
      ),
      true,
    );
  });

  it("labels when each rule set applies", () => {
    assert.equal(ruleSetRole(ruleSet({ id: "baseline" })), "Always applied");
    assert.equal(ruleSetRole(ruleSet({ id: "planning" })), "Planning mode");
    assert.equal(ruleSetRole(ruleSet({ id: "supervised" })), "Coding");
  });

  it("counts overrides per rule set and scope", () => {
    const summary = overlaySummary(
      configuration({ supervised: 2 }, { supervised: 1, autonomous: 4 }),
      "supervised",
    );
    assert.deepEqual(summary, {
      project: 2,
      user: 1,
      label: "Project 2 · User 1",
    });
  });

  it("omits the scopes that have no overrides", () => {
    assert.equal(
      overlaySummary(configuration({}, { supervised: 3 }), "supervised").label,
      "User 3",
    );
    assert.equal(
      overlaySummary(configuration({ supervised: 1 }, {}), "supervised").label,
      "Project 1",
    );
  });

  it("reports rule sets with no overrides at all", () => {
    const summary = overlaySummary(
      configuration({ supervised: 2 }, {}),
      "autonomous",
    );
    assert.deepEqual(summary, { project: 0, user: 0, label: "No overrides" });
  });
});
