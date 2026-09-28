import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { upgradeToolCallV1ToV2 } from "../../../../src/infrastructure/persistence/payloads/tool-call/upgraders.js";

describe("tool-call payload upgraders", () => {
  it("adds rule-set identities to pre-v0.27 permission evidence", () => {
    const legacy = {
      id: "tool_legacy",
      extension: { retained: true },
      permissionEvaluation: {
        winningRuleOrigin: "project",
        activeRuleSetIds: ["autonomous", "project-overlay"],
        nestedExtension: { retained: true },
      },
    };

    assert.deepEqual(upgradeToolCallV1ToV2(legacy), {
      ...legacy,
      permissionEvaluation: {
        ...legacy.permissionEvaluation,
        winningRuleSetId: "project-overlay",
        selectedRuleSetId: "project-overlay",
      },
    });
    assert.equal("selectedRuleSetId" in legacy.permissionEvaluation, false);
  });

  it("uses the baseline identity for a baseline winning rule", () => {
    const upgraded = upgradeToolCallV1ToV2({
      permissionEvaluation: {
        winningRuleOrigin: "baseline",
        activeRuleSetIds: ["autonomous"],
      },
    }) as { permissionEvaluation: Record<string, unknown> };

    assert.equal(upgraded.permissionEvaluation.winningRuleSetId, "baseline");
    assert.equal(upgraded.permissionEvaluation.selectedRuleSetId, "autonomous");
  });

  it("does not overwrite identities already persisted", () => {
    const current = {
      permissionEvaluation: {
        winningRuleOrigin: "project",
        activeRuleSetIds: ["autonomous", "new-selection"],
        winningRuleSetId: "original-winner",
        selectedRuleSetId: "original-selection",
      },
    };
    assert.equal(upgradeToolCallV1ToV2(current), current);
  });

  it("leaves unidentifiable malformed evidence for the read schema to reject", () => {
    const malformed = {
      permissionEvaluation: {
        winningRuleOrigin: "project",
        activeRuleSetIds: [],
      },
    };
    assert.equal(upgradeToolCallV1ToV2(malformed), malformed);
  });
});
