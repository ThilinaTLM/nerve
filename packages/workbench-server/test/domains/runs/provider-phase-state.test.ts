import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderPhase } from "@nervekit/contracts/runs";
import {
  assertProviderPhaseTransition,
  providerRetryDecision,
} from "../../../src/domains/runs/runtime/provider-phase-state.js";

const hash = `sha256:${"a".repeat(64)}`;
const phase: ProviderPhase = {
  schemaVersion: 1,
  phaseId: "provider_phase_one",
  runId: "run_one",
  runGeneration: 1,
  selectionEpoch: 2,
  sourceEntryId: "entry_one",
  contextRecipeId: "context_recipe_one",
  requestManifestId: "manifest_request",
  requestHash: hash,
  providerIdentity: { provider: "test", model: "one" },
  capability: "stateless_generation",
  state: "active",
};

test("INV-PROVIDER-01 permits bounded repeat of a frozen stateless request", () => {
  assert.deepEqual(
    providerRetryDecision({
      phase,
      dispatchPossible: true,
      completePreparedResponse: false,
      providerSideEffects: false,
    }),
    { kind: "retry_same_frozen_phase" },
  );
});

test("INV-PROVIDER-01 does not retry provider-side effects from missing transcript output", () => {
  assert.deepEqual(
    providerRetryDecision({
      phase: { ...phase, capability: "non_repeatable_or_unknown" },
      dispatchPossible: true,
      completePreparedResponse: false,
      providerSideEffects: true,
    }),
    {
      kind: "reconcile_or_recovery_required",
      reason: "provider_side_effect_may_have_occurred",
    },
  );
});

test("INV-PROVIDER-01 commits a complete prepared response instead of regenerating", () => {
  assert.deepEqual(
    providerRetryDecision({
      phase,
      dispatchPossible: true,
      completePreparedResponse: true,
      providerSideEffects: false,
    }),
    { kind: "commit_prepared_response" },
  );
});

test("INV-PROVIDER-01 preserves phase bindings and requires recovery admission", () => {
  assert.throws(
    () =>
      assertProviderPhaseTransition(phase, {
        ...phase,
        state: "response_prepared",
        sourceEntryId: "entry_other",
      }),
    /sourceEntryId/,
  );
  const recovery: ProviderPhase = {
    ...phase,
    state: "recovery_required",
  };
  assert.throws(
    () =>
      assertProviderPhaseTransition(recovery, {
        ...recovery,
        state: "ready",
      }),
    /recovery admission/,
  );
});
