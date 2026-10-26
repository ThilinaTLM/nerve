import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import {
  isDefaultEligible,
  newRuleTemplate,
  overlaySummary,
  ruleMetadata,
  validateRuleSource,
} from "./permission-rule-sets-view";

function ruleSet(
  overrides: Partial<PermissionRuleSetSummary> & { id: string },
): PermissionRuleSetSummary {
  return {
    name: overrides.id,
    source: "builtin",
    enabled: true,
    available: true,
    ...overrides,
  } as PermissionRuleSetSummary;
}

function rule(id: string, overrides: Partial<PermissionRule> = {}) {
  return {
    id,
    enabled: true,
    priority: 10,
    enforcement: "overridable",
    when: { toolNames: ["bash"] },
    decision: "prompt",
    ...overrides,
  } as PermissionRule;
}

function configuration(
  projectRuleCounts: Record<string, number>,
  userRuleCounts: Record<string, number>,
  trust: PermissionPolicyConfiguration["projectTrust"]["status"] = "trusted",
): PermissionPolicyConfiguration {
  const document = (counts: Record<string, number>) => ({
    schemaVersion: 2 as const,
    overlays: Object.entries(counts).map(([ruleSetId, count]) => ({
      ruleSetId,
      rules: Array.from({ length: count }, (_, index) =>
        rule(`${ruleSetId}-${index}`, { priority: index }),
      ),
    })),
  });
  return {
    projectOverlays: document(projectRuleCounts),
    userOverlays: document(userRuleCounts),
    projectTrust: { status: trust },
  } as unknown as PermissionPolicyConfiguration;
}

describe("permission rule set view helpers", () => {
  it("offers the coding rule sets as default choices", () => {
    for (const id of ["read_only", "supervised", "autonomous"]) {
      assert.equal(isDefaultEligible(ruleSet({ id })), true, id);
    }
  });

  it("never offers baseline as the default", () => {
    assert.equal(isDefaultEligible(ruleSet({ id: "baseline" })), false);
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
  });

  it("summarises user and project override counts per rule set", () => {
    const summary = overlaySummary(
      configuration({ supervised: 2 }, { supervised: 1, autonomous: 4 }),
      "supervised",
    );
    assert.deepEqual(summary, {
      user: 1,
      project: 2,
      label: "1 user override · 2 project overrides",
    });
  });

  it("omits scopes without overrides and reports none at all", () => {
    assert.equal(
      overlaySummary(configuration({}, { supervised: 3 }), "supervised").label,
      "3 user overrides",
    );
    assert.equal(
      overlaySummary(configuration({ supervised: 2 }, {}), "autonomous").label,
      "No overrides",
    );
  });

  it("flags project overrides that are not applied", () => {
    assert.equal(
      overlaySummary(
        configuration({ supervised: 1 }, {}, "untrusted"),
        "supervised",
      ).label,
      "1 project override (not applied)",
    );
  });

  it("describes a rule by its tools, condition count and decision", () => {
    assert.deepEqual(
      ruleMetadata(
        rule("a", {
          decision: "deny",
          when: { toolNames: ["bash", "read"], baseRisks: ["write"] },
        }),
      ),
      ["bash, read", "2 conditions", "Block"],
    );
    assert.deepEqual(ruleMetadata(rule("b", { when: {}, decision: "allow" })), [
      "Any tool",
      "0 conditions",
      "Allow",
    ]);
  });

  it("creates a valid starting rule that avoids existing IDs and priorities", () => {
    const siblings = [rule("new-rule-1", { priority: 0 })];
    const template = newRuleTemplate(siblings);
    const validation = validateRuleSource(
      template,
      "user",
      "supervised",
      siblings,
    );
    assert.equal(validation.error, undefined);
    assert.equal(validation.rule?.id, "new-rule-2");
    assert.equal(validation.rule?.priority, 1);
  });

  it("validates JSON syntax, the rule schema, and sibling conflicts", () => {
    const siblings = [rule("a", { priority: 5 })];
    assert.match(
      validateRuleSource("{", "user", "supervised", siblings).error ?? "",
      /Invalid JSON/,
    );
    assert.match(
      validateRuleSource(
        JSON.stringify(rule("b", { priority: 5000 })),
        "user",
        "supervised",
        siblings,
      ).error ?? "",
      /priority/,
    );
    assert.match(
      validateRuleSource(
        JSON.stringify(rule("a", { priority: 6 })),
        "user",
        "supervised",
        siblings,
      ).error ?? "",
      /unique/i,
    );
    assert.match(
      validateRuleSource(
        JSON.stringify(rule("b", { priority: 5 })),
        "user",
        "supervised",
        siblings,
      ).error ?? "",
      /unique/i,
    );
  });

  it("applies the project restriction against guardrails", () => {
    const guardrail = rule("g", { enforcement: "guardrail", decision: "deny" });
    assert.equal(
      validateRuleSource(JSON.stringify(guardrail), "user", "supervised", [])
        .error,
      undefined,
    );
    assert.match(
      validateRuleSource(JSON.stringify(guardrail), "project", "supervised", [])
        .error ?? "",
      /overridable/,
    );
  });
});
