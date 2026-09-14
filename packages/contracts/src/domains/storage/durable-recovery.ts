import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.string().datetime();

export const backupManifestEntrySchema = z.object({
  kind: z.enum([
    "database",
    "artifact",
    "permission_file",
    "trust_evidence",
    "execution_snapshot",
  ]),
  ownerId: z.string().min(1).max(768).optional(),
  relativeLocator: z.string().min(1).max(2_048),
  digest: digestSchema,
  byteLength: z.number().int().nonnegative().safe(),
  schemaVersion: z.string().min(1).max(128).optional(),
});

export type BackupManifestEntry = z.infer<typeof backupManifestEntrySchema>;

export const portableBackupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  backupId: z.string().startsWith("backup_"),
  namespaceId: z.string().startsWith("namespace_"),
  sourceExecutionIncarnationId: z.string().startsWith("incarnation_"),
  storageFormatVersion: z.number().int().positive(),
  entryCount: z.number().int().positive().safe(),
  entriesManifestLocator: z.string().min(1).max(2_048),
  entriesManifestDigest: digestSchema,
  manifestDigest: digestSchema,
  capturedAt: isoDateTimeSchema,
});
export type PortableBackupManifest = z.infer<
  typeof portableBackupManifestSchema
>;

export const restorePromotionSchema = z
  .object({
    schemaVersion: z.literal(1),
    restoreId: z.string().startsWith("restore_"),
    backupId: z.string().startsWith("backup_"),
    namespaceId: z.string().startsWith("namespace_"),
    priorExecutionIncarnationId: z.string().startsWith("incarnation_"),
    promotedExecutionIncarnationId: z.string().startsWith("incarnation_"),
    oldRuntimeIsolation: z.enum(["proven", "unproven"]),
    dispatchState: z.enum(["quarantined", "disabled", "admitted"]),
    quarantinedRunCount: z.number().int().nonnegative().safe(),
    quarantineManifestDigest: digestSchema,
    promotedAt: isoDateTimeSchema,
  })
  .superRefine((value, context) => {
    if (
      value.priorExecutionIncarnationId === value.promotedExecutionIncarnationId
    ) {
      context.addIssue({
        code: "custom",
        path: ["promotedExecutionIncarnationId"],
        message: "Restore must promote a fresh execution incarnation.",
      });
    }
    if (
      value.oldRuntimeIsolation === "unproven" &&
      value.dispatchState !== "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["dispatchState"],
        message: "Dispatch must remain disabled until isolation is proven.",
      });
    }
  });
export type RestorePromotion = z.infer<typeof restorePromotionSchema>;

export const homePromotionMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  restoreId: z.string().startsWith("restore_"),
  backupId: z.string().startsWith("backup_"),
  liveHomeName: z.string().min(1).max(255),
  candidateHomeName: z.string().min(1).max(255),
  rollbackHomeName: z.string().min(1).max(255),
  candidatePromotionDigest: digestSchema,
  state: z.enum([
    "requested",
    "old_home_renamed",
    "candidate_promoted",
    "verified",
  ]),
  requestedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type HomePromotionMarker = z.infer<typeof homePromotionMarkerSchema>;

export const runtimeAdmissionSchema = z.object({
  schemaVersion: z.literal(1),
  executionIncarnationId: z.string().startsWith("incarnation_"),
  dispatchState: z.enum(["quarantined", "disabled", "admitted"]),
  restoreId: z.string().startsWith("restore_").optional(),
  updatedAt: isoDateTimeSchema,
});
export type RuntimeAdmission = z.infer<typeof runtimeAdmissionSchema>;

export const timelineAuthorityPromotionSchema = z.object({
  schemaVersion: z.literal(1),
  promotionId: z.string().startsWith("promotion_"),
  namespaceId: z.string().startsWith("namespace_"),
  priorExecutionIncarnationId: z.string().startsWith("incarnation_"),
  executionIncarnationId: z.string().startsWith("incarnation_"),
  proofDigest: digestSchema,
  oldRuntimeIsolated: z.literal(true),
  state: z.literal("promoted"),
  promotedAt: isoDateTimeSchema,
});
export type TimelineAuthorityPromotion = z.infer<
  typeof timelineAuthorityPromotionSchema
>;

export const deletionIntentSchema = z.object({
  schemaVersion: z.literal(1),
  conversationId: z.string().startsWith("conv_"),
  commandId: z.string().min(1).max(256),
  fenceRevision: z.number().int().nonnegative().safe(),
  phase: z.enum([
    "fenced",
    "settling_execution",
    "removing_payloads",
    "removing_history",
    "retaining_replay_evidence",
    "finalized",
  ]),
  cleanupCursor: z.string().min(1).max(2_048).optional(),
  uncertaintyAcknowledged: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DeletionIntent = z.infer<typeof deletionIntentSchema>;

export const artifactDeletionWorkSchema = z.object({
  schemaVersion: z.literal(1),
  workId: z.string().startsWith("artifact_delete_"),
  conversationId: z.string().startsWith("conv_"),
  preparationId: z.string().startsWith("preparation_"),
  relativeLocator: z.string().min(1).max(2_048),
  expectedDigest: digestSchema,
  expectedByteLength: z.number().int().nonnegative().safe(),
  state: z.enum(["planned", "deleting", "deleted", "missing", "failed"]),
  attemptCount: z.number().int().nonnegative().safe(),
  lastError: z.string().max(4_096).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ArtifactDeletionWork = z.infer<typeof artifactDeletionWorkSchema>;

export const ownerTombstoneSchema = z.object({
  schemaVersion: z.literal(1),
  ownerKind: z.enum(["conversation", "state"]),
  ownerId: z.string().min(1).max(768),
  namespaceId: z.string().startsWith("namespace_"),
  commandReservationCount: z.number().int().nonnegative().safe(),
  effectReservationCount: z.number().int().nonnegative().safe(),
  replayEvidenceDigest: digestSchema,
  deletedAt: isoDateTimeSchema,
});
export type OwnerTombstone = z.infer<typeof ownerTombstoneSchema>;
