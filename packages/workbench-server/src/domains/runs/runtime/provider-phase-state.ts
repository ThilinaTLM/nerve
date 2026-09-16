import type { ProviderPhase } from "@nervekit/contracts/runs";

const legalTransitions: Readonly<
  Record<ProviderPhase["state"], readonly ProviderPhase["state"][]>
> = {
  preparing: ["ready", "recovery_required", "closed"],
  ready: ["active", "closed"],
  active: ["response_prepared", "ready", "recovery_required", "closed"],
  response_prepared: ["committed", "recovery_required", "closed"],
  recovery_required: ["ready", "response_prepared", "closed"],
  committed: [],
  closed: [],
};

export function assertProviderPhaseTransition(
  current: ProviderPhase,
  next: ProviderPhase,
): void {
  for (const field of [
    "phaseId",
    "runId",
    "runGeneration",
    "selectionEpoch",
    "sourceEntryId",
    "contextRecipeId",
    "providerIdentity",
    "capability",
    "opaqueStateManifestId",
  ] as const) {
    if (stable(current[field]) !== stable(next[field])) {
      throw new Error(`Provider phase binding cannot change: ${field}.`);
    }
  }
  if (!legalTransitions[current.state].includes(next.state)) {
    throw new Error(
      `Illegal provider phase transition: ${current.state} -> ${next.state}.`,
    );
  }
  if (next.state === "committed" && !next.committedResponseId) {
    throw new Error(
      "A committed provider phase requires one response identity.",
    );
  }
  if (
    current.committedResponseId &&
    current.committedResponseId !== next.committedResponseId
  ) {
    throw new Error("A committed provider response cannot be replaced.");
  }
  if (
    current.state === "recovery_required" &&
    (next.state === "ready" || next.state === "response_prepared") &&
    !next.recoveryAdmissionId
  ) {
    throw new Error("Provider recovery requires a durable recovery admission.");
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export type ProviderRetryDecision =
  | { kind: "retry_same_frozen_phase" }
  | { kind: "reconcile_or_recovery_required"; reason: string }
  | { kind: "commit_prepared_response" };

export function providerRetryDecision(input: {
  phase: ProviderPhase;
  dispatchPossible: boolean;
  completePreparedResponse: boolean;
  providerSideEffects: boolean;
}): ProviderRetryDecision {
  if (input.completePreparedResponse) {
    return { kind: "commit_prepared_response" };
  }
  if (!input.dispatchPossible) {
    return { kind: "retry_same_frozen_phase" };
  }
  if (
    input.phase.capability === "stateless_generation" &&
    !input.providerSideEffects &&
    input.phase.requestManifestId &&
    input.phase.requestHash
  ) {
    return { kind: "retry_same_frozen_phase" };
  }
  return {
    kind: "reconcile_or_recovery_required",
    reason: input.providerSideEffects
      ? "provider_side_effect_may_have_occurred"
      : "provider_retry_capability_unproven",
  };
}
