import { z } from "zod";
import { toolReplayCapabilitySchema } from "../tools/replay-capability.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const entryId = z.string().startsWith("entry_");
const runId = z.string().startsWith("run_");
const safeInteger = z.number().int().nonnegative().safe();

export const runControlStateSchema = z.enum([
  "preparing",
  "running",
  "partially_waiting",
  "waiting",
  "recovery_required",
  "completed",
  "failed",
  "cancelled",
  "abandoned",
  "superseded",
  "deletion_fenced",
]);

export const runControlSchema = z.object({
  schemaVersion: z.literal(1),
  conversationId: z.string().startsWith("conv_"),
  runId,
  generation: z.number().int().positive().safe(),
  boundSelectionEpoch: safeInteger,
  continuationEntryId: entryId.nullable(),
  checkpointId: z.string().startsWith("checkpoint_").nullable(),
  waitGroupId: z.string().startsWith("wait_group_").nullable(),
  providerPhaseId: z.string().startsWith("provider_phase_").nullable(),
  state: runControlStateSchema,
  foregroundOwned: z.boolean(),
  revision: z.number().int().positive().safe(),
  recoveryReason: z.string().min(1).max(128).optional(),
});
export type RunControl = z.infer<typeof runControlSchema>;

export const immutableExecutionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().startsWith("snapshot_"),
  runId,
  compatibilityVersion: z.string().min(1).max(128),
  manifestId: z.string().startsWith("manifest_"),
  digest,
  modelContextRecipeVersion: z.number().int().positive(),
  opaqueProviderStateManifestId: z.string().startsWith("manifest_").optional(),
  createdAt: z.string().datetime(),
});
export type ImmutableExecutionSnapshot = z.infer<
  typeof immutableExecutionSnapshotSchema
>;

export const canonicalCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  checkpointId: z.string().startsWith("checkpoint_"),
  conversationId: z.string().startsWith("conv_"),
  runId,
  agentId: z.string().startsWith("agent_"),
  captureRevision: safeInteger,
  captureTransitionId: z.string().startsWith("transition_"),
  anchorEntryId: entryId.nullable(),
  selectionEpoch: safeInteger,
  runGeneration: z.number().int().positive().safe(),
  executionPhase: z.string().min(1).max(128),
  snapshotId: z.string().startsWith("snapshot_"),
  pendingManifestId: z.string().startsWith("manifest_"),
  waitGroupId: z.string().startsWith("wait_group_"),
  contextRecipeVersion: z.number().int().positive(),
  integrityHash: digest,
  createdAt: z.string().datetime(),
});
export type CanonicalCheckpoint = z.infer<typeof canonicalCheckpointSchema>;

export const waitGroupMemberExecutionStateSchema = z.enum([
  "drafted",
  "awaiting_approval",
  "authorized",
  "executing",
  "succeeded",
  "known_failed",
  "denied",
  "cancelled",
  "outcome_unknown",
  "result_unavailable",
  "closed",
]);

export const waitGroupAttachmentDispositionSchema = z.enum([
  "pending",
  "attached",
  "not_executed",
  "outcome_unknown",
  "result_unavailable",
  "detached",
]);

export const waitGroupMemberSchema = z
  .object({
    schemaVersion: z.literal(1),
    memberId: z.string().startsWith("member_"),
    waitGroupId: z.string().startsWith("wait_group_"),
    memberKind: z.enum(["tool", "interaction", "child_agent"]),
    ownerId: z.string().min(1).max(256),
    inputFingerprint: digest,
    policyFingerprint: digest.optional(),
    executionState: waitGroupMemberExecutionStateSchema,
    attachmentDisposition: waitGroupAttachmentDispositionSchema,
    resultEntryId: entryId.optional(),
    nonDispatchEvidenceId: z.string().startsWith("evidence_").optional(),
    contributesToBarrier: z.boolean(),
    revision: z.number().int().positive().safe(),
  })
  .superRefine((member, context) => {
    const attachedOutcome =
      (member.executionState === "succeeded" ||
        member.executionState === "known_failed") &&
      member.attachmentDisposition === "attached" &&
      member.resultEntryId !== undefined;
    const provenNonExecution =
      (member.executionState === "denied" ||
        member.executionState === "cancelled") &&
      member.attachmentDisposition === "not_executed" &&
      member.resultEntryId === undefined &&
      member.nonDispatchEvidenceId !== undefined;
    if (
      member.contributesToBarrier !== (attachedOutcome || provenNonExecution)
    ) {
      context.addIssue({
        code: "custom",
        path: ["contributesToBarrier"],
        message:
          "Barrier contribution requires an attached outcome or proven non-execution.",
      });
    }
  });
export type WaitGroupMember = z.infer<typeof waitGroupMemberSchema>;

export const waitGroupSchema = z.object({
  schemaVersion: z.literal(1),
  waitGroupId: z.string().startsWith("wait_group_"),
  runId,
  membershipManifestId: z.string().startsWith("manifest_"),
  continuationEntryId: entryId.nullable(),
  continuationConsumed: z.boolean(),
  state: z.enum(["open", "ready", "closed", "recovery_required"]),
  revision: z.number().int().positive().safe(),
  members: z.array(waitGroupMemberSchema).max(32),
});
export type WaitGroup = z.infer<typeof waitGroupSchema>;

export const exactCallAuthorizationSchema = z.object({
  schemaVersion: z.literal(1),
  authorizationId: z.string().startsWith("authorization_"),
  memberId: z.string().startsWith("member_"),
  normalizedInputFingerprint: digest,
  policyObservationId: z.string().startsWith("policy_observation_"),
  runGeneration: z.number().int().positive().safe(),
  selectionEpoch: safeInteger,
  state: z.enum(["active", "consumed", "revoked", "superseded"]),
  evidence: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type ExactCallAuthorization = z.infer<
  typeof exactCallAuthorizationSchema
>;

export const logicalEffectSchema = z.object({
  schemaVersion: z.literal(1),
  effectId: z.string().startsWith("effect_"),
  memberId: z.string().startsWith("member_"),
  toolName: z.string().min(1).max(128),
  capability: toolReplayCapabilitySchema,
  normalizedInputFingerprint: digest,
  owner: z.record(z.string(), z.unknown()),
  externalScope: z.record(z.string(), z.unknown()).optional(),
  externalKey: z.string().min(1).max(512).optional(),
  authorizationId: z.string().startsWith("authorization_"),
  state: z.enum([
    "authorized",
    "dispatching",
    "settled",
    "outcome_unknown",
    "result_unavailable",
    "closed",
  ]),
  createdAt: z.string().datetime(),
});
export type LogicalEffect = z.infer<typeof logicalEffectSchema>;

export const canonicalExecutionAttemptSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().startsWith("attempt_"),
    effectId: z.string().startsWith("effect_").optional(),
    providerPhaseId: z.string().startsWith("provider_phase_").optional(),
    attemptNumber: z.number().int().positive().safe(),
    executionIncarnationId: z.string().startsWith("incarnation_"),
    state: z.enum([
      "ready",
      "claimed",
      "dispatched",
      "succeeded",
      "known_failed",
      "cancelled",
      "outcome_unknown",
      "result_unavailable",
    ]),
    outcome: z.unknown().optional(),
    preparedManifestId: z.string().startsWith("manifest_").optional(),
    externalLocator: z.string().min(1).max(2_048).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((attempt, context) => {
    if (
      (attempt.effectId !== undefined) ===
      (attempt.providerPhaseId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectId"],
        message:
          "An execution attempt belongs to exactly one effect or provider phase.",
      });
    }
  });
export type CanonicalExecutionAttempt = z.infer<
  typeof canonicalExecutionAttemptSchema
>;

export const executionClaimSchema = z.object({
  schemaVersion: z.literal(1),
  claimId: z.string().startsWith("claim_"),
  attemptId: z.string().startsWith("attempt_"),
  token: z.string().min(32).max(512),
  generation: safeInteger,
  executionIncarnationId: z.string().startsWith("incarnation_"),
  leaseDeadline: z.string().datetime(),
  state: z.enum(["active", "consumed", "revoked", "expired"]),
});
export type ExecutionClaim = z.infer<typeof executionClaimSchema>;

export const recoveryActionSchema = z.object({
  schemaVersion: z.literal(1),
  actionId: z.string().startsWith("recovery_"),
  conversationId: z.string().startsWith("conv_"),
  runId: runId.optional(),
  memberId: z.string().startsWith("member_").optional(),
  effectId: z.string().startsWith("effect_").optional(),
  actionKind: z.enum([
    "retry_after_non_dispatch",
    "retry_safe_observation",
    "contractual_replay",
    "reconcile_external_effect",
    "attach_verified_result",
    "close_unavailable",
    "cancel_tree",
  ]),
  evidence: z.record(z.string(), z.unknown()),
  evidenceManifestId: z.string().startsWith("manifest_").optional(),
  status: z.enum(["prepared", "admitted", "applied", "rejected", "superseded"]),
  commandId: z.string().min(1).max(256),
  createdAt: z.string().datetime(),
});
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export const providerPhaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    phaseId: z.string().startsWith("provider_phase_"),
    runId,
    runGeneration: z.number().int().positive().safe(),
    selectionEpoch: safeInteger,
    sourceEntryId: entryId.nullable(),
    contextRecipeId: z.string().startsWith("context_recipe_"),
    requestManifestId: z.string().startsWith("manifest_").optional(),
    requestHash: digest.optional(),
    providerIdentity: z.record(z.string(), z.unknown()),
    capability: z.enum([
      "stateless_generation",
      "contractually_replay_safe",
      "non_repeatable_or_unknown",
    ]),
    opaqueStateManifestId: z.string().startsWith("manifest_").optional(),
    state: z.enum([
      "preparing",
      "ready",
      "active",
      "response_prepared",
      "recovery_required",
      "committed",
      "closed",
    ]),
    committedResponseId: z.string().startsWith("response_").optional(),
    recoveryAdmissionId: z.string().startsWith("recovery_").optional(),
  })
  .superRefine((phase, context) => {
    if (
      phase.state !== "preparing" &&
      phase.state !== "closed" &&
      (!phase.requestManifestId || !phase.requestHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestManifestId"],
        message:
          "A prepared provider request requires its frozen manifest and hash.",
      });
    }
    if ((phase.state === "committed") !== Boolean(phase.committedResponseId)) {
      context.addIssue({
        code: "custom",
        path: ["committedResponseId"],
        message: "Exactly a committed phase has a committed response identity.",
      });
    }
  });
export type ProviderPhase = z.infer<typeof providerPhaseSchema>;
