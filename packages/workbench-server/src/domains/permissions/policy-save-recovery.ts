import type { PolicySaveIntent } from "@nervekit/contracts/permissions";

export type PolicySaveRecoveryDecision =
  | { kind: "retry_file_write" }
  | { kind: "finalize_approval" }
  | { kind: "record_residual_grant" }
  | { kind: "record_conflict" }
  | { kind: "leave_terminal" };

/** INV-POLICY-04: reconcile intent without overwriting a newer file edit. */
export function decidePolicySaveRecovery(input: {
  intent: PolicySaveIntent;
  currentDocumentDigest?: string;
  currentDocumentValid: boolean;
  approvalStillApplicable: boolean;
}): PolicySaveRecoveryDecision {
  const { intent } = input;
  if (
    intent.state === "save_failed" ||
    intent.state === "conflicted" ||
    intent.state === "finalized" ||
    intent.state === "finalization_superseded"
  ) {
    return { kind: "leave_terminal" };
  }
  if (
    input.currentDocumentValid &&
    input.currentDocumentDigest === intent.intendedDocumentDigest
  ) {
    return input.approvalStillApplicable
      ? { kind: "finalize_approval" }
      : { kind: "record_residual_grant" };
  }
  if (
    (intent.state === "recorded" || intent.state === "writing") &&
    input.currentDocumentDigest === intent.observedDocumentDigest
  ) {
    return { kind: "retry_file_write" };
  }
  return { kind: "record_conflict" };
}
