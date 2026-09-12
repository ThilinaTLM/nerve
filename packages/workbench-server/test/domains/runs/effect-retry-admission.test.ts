import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEffectRetryAdmission } from "../../../src/domains/runs/runtime/effect-retry-admission.js";

const common = {
  effectId: "effect_one",
  dispatchPossible: true,
  resultAlreadyCommitted: false,
  applicable: true,
  currentPolicyAllows: true,
  now: 1_000,
};

test("INV-EFFECT-01 admits a fresh observation under the same logical effect", () => {
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      capability: { kind: "safe_repeat_observation", version: 1 },
    }),
    {
      kind: "admitted_safe_observation",
      effectId: "effect_one",
      recordsFreshObservation: true,
    },
  );
});

test("INV-EFFECT-01 blocks possible redispatch of unknown effects", () => {
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      capability: { kind: "non_repeatable_or_unknown", version: 1 },
    }),
    { kind: "not_admitted", reason: "non_dispatch_proof_required" },
  );
});

test("INV-EFFECT-01 permits any capability after conclusive non-dispatch proof", () => {
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      dispatchPossible: false,
      capability: { kind: "non_repeatable_or_unknown", version: 1 },
    }),
    { kind: "admitted_after_proven_non_dispatch", effectId: "effect_one" },
  );
});

test("INV-EFFECT-01 requires a live proven external replay contract", () => {
  const capability = {
    kind: "contractually_replay_safe_effect" as const,
    version: 1,
    externalKeyEncoding: "header-v1",
    externalKeyScope: "account",
    retentionWindowMs: 5_000,
    reconciliation: "supported" as const,
  };
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      capability,
      externalKey: "effect-one",
      replayContractProven: true,
      replayWindowExpiresAt: 4_000,
    }),
    {
      kind: "admitted_contractual_replay",
      effectId: "effect_one",
      externalKey: "effect-one",
    },
  );
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      now: 4_000,
      capability,
      externalKey: "effect-one",
      replayContractProven: true,
      replayWindowExpiresAt: 4_000,
    }),
    { kind: "not_admitted", reason: "replay_window_expired" },
  );
});

test("INV-EFFECT-01 never replaces an already committed result", () => {
  assert.deepEqual(
    evaluateEffectRetryAdmission({
      ...common,
      resultAlreadyCommitted: true,
      capability: { kind: "safe_repeat_observation", version: 1 },
    }),
    { kind: "not_admitted", reason: "already_committed" },
  );
});
