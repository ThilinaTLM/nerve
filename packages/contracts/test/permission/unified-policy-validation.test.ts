import assert from "node:assert/strict";
import test from "node:test";
import {
  policyFallbackDecisionSchema,
  policySaveIntentSchema,
} from "../../src/domains/permissions/unified-policy.js";

const hash = `sha256:${"a".repeat(64)}`;

test("INV-POLICY-03 baseline fallback explicitly disables overlays", () => {
  const decision = {
    schemaVersion: 1,
    decisionId: "policy_decision_one",
    diagnosticId: "policy_diagnostic_one",
    requestedRuleSetId: "custom",
    effectiveRuleSetId: "baseline",
    overlaysEnabled: false,
    confirmationFingerprint: hash,
    state: "active",
    decidedAt: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(policyFallbackDecisionSchema.safeParse(decision).success, true);
  assert.equal(
    policyFallbackDecisionSchema.safeParse({
      ...decision,
      overlaysEnabled: true,
    }).success,
    false,
  );
});

test("INV-POLICY-04 represents saved but unfinalized approval", () => {
  const parsed = policySaveIntentSchema.parse({
    schemaVersion: 1,
    saveIntentId: "policy_save_one",
    commandId: "command_one",
    scope: { kind: "project", ownerId: "proj_one" },
    documentIdentity: "permissions/project.json",
    intendedDocumentDigest: hash,
    ruleFingerprint: hash,
    state: "saved_pending_finalization",
    fileOutcome: "saved",
    approvalOutcome: "not_attempted",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(parsed.fileOutcome, "saved");
  assert.equal(parsed.approvalOutcome, "not_attempted");
});
