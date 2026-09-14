import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.string().datetime();

export const policyScopeReferenceSchema = z.object({
  kind: z.enum(["user", "project", "conversation"]),
  ownerId: z.string().min(1).max(768),
});
export type PolicyScopeReference = z.infer<typeof policyScopeReferenceSchema>;

export const policyDocumentObservationSchema = z.object({
  schemaVersion: z.literal(1),
  observationId: z.string().startsWith("policy_observation_"),
  scope: policyScopeReferenceSchema,
  documentIdentity: z.string().min(1).max(2_048),
  completeDocumentDigest: digestSchema,
  selectedRuleSetId: z.string().min(1).max(256),
  selectedRuleSetDigest: digestSchema,
  applicableOverlayDigests: z
    .array(
      z.object({
        scope: policyScopeReferenceSchema,
        documentIdentity: z.string().min(1).max(2_048),
        digest: digestSchema,
      }),
    )
    .max(3),
  normalizedInputFingerprint: digestSchema,
  trustEvidence: z.record(z.string(), z.unknown()),
  observedAt: isoDateTimeSchema,
});
export type PolicyDocumentObservation = z.infer<
  typeof policyDocumentObservationSchema
>;

export const policyDiagnosticSchema = z.object({
  schemaVersion: z.literal(1),
  diagnosticId: z.string().startsWith("policy_diagnostic_"),
  scope: policyScopeReferenceSchema,
  documentIdentity: z.string().min(1).max(2_048),
  failureFingerprint: digestSchema,
  failureKind: z.enum([
    "malformed_overlay",
    "unsupported_overlay",
    "unreadable_overlay",
    "missing_rule_set",
    "invalid_rule_set",
    "incompatible_rule_set",
    "quarantine_failed",
  ]),
  affectedMemberIds: z.array(z.string().startsWith("member_")).max(32),
  state: z.enum(["unresolved", "repaired", "reset", "fallback_selected"]),
  observedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
});
export type PolicyDiagnostic = z.infer<typeof policyDiagnosticSchema>;

export const policyFallbackDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  decisionId: z.string().startsWith("policy_decision_"),
  diagnosticId: z.string().startsWith("policy_diagnostic_"),
  requestedRuleSetId: z.string().min(1).max(256),
  effectiveRuleSetId: z.literal("baseline"),
  overlaysEnabled: z.literal(false),
  confirmationFingerprint: digestSchema,
  state: z.enum(["active", "replaced"]),
  decidedAt: isoDateTimeSchema,
});
export type PolicyFallbackDecision = z.infer<
  typeof policyFallbackDecisionSchema
>;

const policySaveIntentBaseSchema = z.object({
  saveIntentId: z.string().startsWith("policy_save_"),
  commandId: z.string().min(1).max(256),
  scope: policyScopeReferenceSchema,
  documentIdentity: z.string().min(1).max(2_048),
  observedDocumentDigest: digestSchema.optional(),
  intendedDocumentDigest: digestSchema,
  ruleFingerprint: digestSchema,
  state: z.enum([
    "recorded",
    "writing",
    "saved_pending_finalization",
    "save_failed",
    "conflicted",
    "finalized",
    "finalization_superseded",
  ]),
  fileOutcome: z
    .enum(["not_attempted", "saved", "failed", "external_conflict"])
    .default("not_attempted"),
  approvalOutcome: z
    .enum(["not_attempted", "committed", "superseded", "failed"])
    .default("not_attempted"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const policySaveIntentSchema = z.discriminatedUnion("schemaVersion", [
  policySaveIntentBaseSchema.extend({ schemaVersion: z.literal(1) }),
  policySaveIntentBaseSchema.extend({
    schemaVersion: z.literal(2),
    conversationId: z.string().startsWith("conv_"),
    runId: z.string().startsWith("run_"),
    memberId: z.string().startsWith("member_"),
    approvalCommandId: z.string().min(1).max(256),
    intendedDocumentManifestId: z.string().startsWith("manifest_"),
  }),
]);
export type PolicySaveIntent = z.infer<typeof policySaveIntentSchema>;
