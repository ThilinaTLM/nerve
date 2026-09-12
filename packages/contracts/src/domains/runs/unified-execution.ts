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

export const waitGroupMemberStateSchema = z.enum([
  "drafted",
  "awaiting_approval",
  "authorized",
  "executing",
  "succeeded_attached",
  "known_failed_attached",
  "not_executed",
  "outcome_unknown",
  "result_unavailable",
  "closed_detached",
]);

export const waitGroupMemberSchema = z.object({
  schemaVersion: z.literal(1),
  memberId: z.string().startsWith("member_"),
  waitGroupId: z.string().startsWith("wait_group_"),
  memberKind: z.enum(["tool", "interaction", "child_agent"]),
  ownerId: z.string().min(1).max(256),
  inputFingerprint: digest,
  policyFingerprint: digest.optional(),
  state: waitGroupMemberStateSchema,
  resultEntryId: entryId.optional(),
  contributesToBarrier: z.boolean(),
  revision: z.number().int().positive().safe(),
});

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
});
export type LogicalEffect = z.infer<typeof logicalEffectSchema>;

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

export const providerPhaseSchema = z.object({
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
});
export type ProviderPhase = z.infer<typeof providerPhaseSchema>;
