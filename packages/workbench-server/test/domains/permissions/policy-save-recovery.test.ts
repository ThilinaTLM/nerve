import assert from "node:assert/strict";
import test from "node:test";
import type { PolicySaveIntent } from "@nervekit/contracts/permissions";
import { decidePolicySaveRecovery } from "../../../src/domains/permissions/policy-save-recovery.js";

const observed = `sha256:${"a".repeat(64)}`;
const intended = `sha256:${"b".repeat(64)}`;
const intent: PolicySaveIntent = {
  schemaVersion: 1,
  saveIntentId: "policy_save_one",
  commandId: "command_one",
  scope: { kind: "project", ownerId: "proj_one" },
  documentIdentity: "permissions/project.json",
  observedDocumentDigest: observed,
  intendedDocumentDigest: intended,
  ruleFingerprint: intended,
  state: "saved_pending_finalization",
  fileOutcome: "saved",
  approvalOutcome: "not_attempted",
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

test("INV-POLICY-04 finalizes only a still-applicable saved grant", () => {
  assert.deepEqual(
    decidePolicySaveRecovery({
      intent,
      currentDocumentDigest: intended,
      currentDocumentValid: true,
      approvalStillApplicable: true,
    }),
    { kind: "finalize_approval" },
  );
});

test("INV-POLICY-04 reports a residual grant after approval supersession", () => {
  assert.deepEqual(
    decidePolicySaveRecovery({
      intent,
      currentDocumentDigest: intended,
      currentDocumentValid: true,
      approvalStillApplicable: false,
    }),
    { kind: "record_residual_grant" },
  );
});

test("INV-POLICY-04 never overwrites a newer external edit", () => {
  assert.deepEqual(
    decidePolicySaveRecovery({
      intent: { ...intent, state: "writing", fileOutcome: "not_attempted" },
      currentDocumentDigest: `sha256:${"c".repeat(64)}`,
      currentDocumentValid: true,
      approvalStillApplicable: true,
    }),
    { kind: "record_conflict" },
  );
});

test("INV-POLICY-04 retries only against the unchanged observed base", () => {
  assert.deepEqual(
    decidePolicySaveRecovery({
      intent: { ...intent, state: "recorded", fileOutcome: "not_attempted" },
      currentDocumentDigest: observed,
      currentDocumentValid: true,
      approvalStillApplicable: true,
    }),
    { kind: "retry_file_write" },
  );
});
