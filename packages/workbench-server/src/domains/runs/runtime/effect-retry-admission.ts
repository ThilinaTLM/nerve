import type { ToolReplayCapability } from "@nervekit/contracts/tools";

export type EffectRetryAdmission =
  | {
      kind: "admitted_safe_observation";
      effectId: string;
      recordsFreshObservation: true;
    }
  | {
      kind: "admitted_after_proven_non_dispatch";
      effectId: string;
    }
  | {
      kind: "admitted_contractual_replay";
      effectId: string;
      externalKey: string;
    }
  | {
      kind: "not_admitted";
      reason:
        | "already_committed"
        | "inapplicable"
        | "policy_changed"
        | "non_dispatch_proof_required"
        | "replay_contract_unproven"
        | "replay_window_expired";
    };

/** INV-EFFECT-01: capability allows evaluation; it never bypasses fences. */
export function evaluateEffectRetryAdmission(input: {
  effectId: string;
  capability: ToolReplayCapability;
  dispatchPossible: boolean;
  resultAlreadyCommitted: boolean;
  applicable: boolean;
  currentPolicyAllows: boolean;
  externalKey?: string;
  replayContractProven?: boolean;
  replayWindowExpiresAt?: number;
  now: number;
}): EffectRetryAdmission {
  if (input.resultAlreadyCommitted) {
    return { kind: "not_admitted", reason: "already_committed" };
  }
  if (!input.applicable) {
    return { kind: "not_admitted", reason: "inapplicable" };
  }
  if (!input.currentPolicyAllows) {
    return { kind: "not_admitted", reason: "policy_changed" };
  }
  if (!input.dispatchPossible) {
    return {
      kind: "admitted_after_proven_non_dispatch",
      effectId: input.effectId,
    };
  }
  if (input.capability.kind === "safe_repeat_observation") {
    return {
      kind: "admitted_safe_observation",
      effectId: input.effectId,
      recordsFreshObservation: true,
    };
  }
  if (input.capability.kind === "non_repeatable_or_unknown") {
    return { kind: "not_admitted", reason: "non_dispatch_proof_required" };
  }
  if (
    !input.replayContractProven ||
    !input.externalKey ||
    input.capability.reconciliation === "unsupported"
  ) {
    return { kind: "not_admitted", reason: "replay_contract_unproven" };
  }
  if (
    input.replayWindowExpiresAt === undefined ||
    input.replayWindowExpiresAt <= input.now
  ) {
    return { kind: "not_admitted", reason: "replay_window_expired" };
  }
  return {
    kind: "admitted_contractual_replay",
    effectId: input.effectId,
    externalKey: input.externalKey,
  };
}
