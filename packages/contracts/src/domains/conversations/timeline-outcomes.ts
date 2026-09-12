import { z } from "zod";
import { timelinePageSchema } from "./timeline.js";

const positionSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  revision: z.number().int().nonnegative().safe(),
  transitionId: z.string().startsWith("transition_").optional(),
});

export const mutationOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("committed"),
    positions: z.array(positionSchema).max(64),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal("receipt_replay"),
    positions: z.array(positionSchema).max(64),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal("cas_conflict"),
    current: z.array(positionSchema).min(1).max(64),
    retry: z.literal("reload_and_revalidate"),
  }),
  z.object({
    kind: z.literal("fingerprint_mismatch"),
    commandId: z.string().min(1).max(256),
    retry: z.literal("never_with_same_command_id"),
  }),
  z.object({
    kind: z.literal("superseded"),
    reason: z.string().min(1).max(128),
    position: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal("cancelled"),
    reason: z.string().min(1).max(128),
    position: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal("deleted_owner"),
    ownerId: z.string().min(1).max(768),
  }),
  z.object({
    kind: z.literal("access_denied"),
    reason: z.string().min(1).max(128),
  }),
]);
export type MutationOutcome = z.infer<typeof mutationOutcomeSchema>;

const reconciliationReasonSchema = z.enum([
  "cursor_expired",
  "projection_rebuilt",
  "projection_version_unavailable",
  "filter_changed",
  "visibility_changed",
  "access_changed",
  "history_deleted",
  "restore_invalidated",
  "snapshot_unavailable",
]);

export const timelineViewOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), page: timelinePageSchema }),
  z.object({
    kind: z.literal("projection_lag"),
    requestedRevision: z.number().int().nonnegative().safe(),
    appliedRevision: z.number().int().nonnegative().safe(),
    canonicalRevision: z.number().int().nonnegative().safe(),
  }),
  z.object({
    kind: z.literal("rebuilding"),
    generation: z.number().int().positive(),
    appliedRevision: z.number().int().nonnegative().safe(),
  }),
  z.object({
    kind: z.literal("incompatible_view"),
    expectedVersion: z.number().int().positive(),
    actualVersion: z.number().int().positive(),
  }),
  z.object({ kind: z.literal("expired_cursor") }),
  z.object({ kind: z.literal("restore_invalidated") }),
  z.object({
    kind: z.literal("reconciliation_required"),
    reason: reconciliationReasonSchema,
    freshViewAvailable: z.boolean(),
  }),
  z.object({
    kind: z.literal("deleted_owner"),
    ownerId: z.string().min(1).max(768),
  }),
  z.object({
    kind: z.literal("access_denied"),
    reason: z.string().min(1).max(128),
  }),
]);
export type TimelineViewOutcome = z.infer<typeof timelineViewOutcomeSchema>;

export const attachmentDispositionSchema = z.enum([
  "pending",
  "attached",
  "not_executed",
  "outcome_unknown",
  "result_unavailable",
  "detached",
]);

export const recoveryActionKindSchema = z.enum([
  "reconcile_outcome",
  "recover_complete_output",
  "supply_replacement_information",
  "repeat_safe_observation",
  "leave_pending",
  "abandon_uncertain_work",
  "start_separately_after_abandonment",
]);

export const memberRecoveryOutcomeSchema = z.object({
  memberId: z.string().startsWith("member_"),
  executionOutcome: z.enum([
    "drafted",
    "awaiting_approval",
    "authorized",
    "executing",
    "succeeded",
    "known_failed",
    "not_executed",
    "outcome_unknown",
    "result_unavailable",
    "closed",
  ]),
  attachmentDisposition: attachmentDispositionSchema,
  contributesToBarrier: z.boolean(),
  recoveryReason: z.string().min(1).max(128).optional(),
  permittedActions: z.array(recoveryActionKindSchema),
});
export type MemberRecoveryOutcome = z.infer<typeof memberRecoveryOutcomeSchema>;

export const policyOperationOutcomeSchema = z.object({
  diagnostic: z
    .object({
      diagnosticId: z.string().startsWith("policy_diagnostic_"),
      scope: z.string().min(1).max(768),
      documentIdentity: z.string().min(1).max(2_048),
      failureFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    })
    .optional(),
  confirmation: z.enum(["not_required", "accepted", "stale", "missing"]),
  save: z.enum([
    "not_requested",
    "pending",
    "succeeded",
    "failed",
    "conflicted",
  ]),
  approvalFinalization: z.enum([
    "not_requested",
    "pending",
    "committed",
    "superseded",
    "failed",
  ]),
});
export type PolicyOperationOutcome = z.infer<
  typeof policyOperationOutcomeSchema
>;
