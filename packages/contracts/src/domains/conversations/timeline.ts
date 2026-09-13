import { z } from "zod";

const safeInteger = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const conversationId = z.string().startsWith("conv_");
const entryId = z.string().startsWith("entry_");
const transitionId = z.string().startsWith("transition_");
const commandId = z.string().min(1).max(256);

export const timelineStateIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  namespaceId: z.string().startsWith("namespace_"),
  executionIncarnationId: z.string().startsWith("incarnation_"),
  formatVersion: z.number().int().positive(),
  promotedAt: z.string().datetime(),
});
export type TimelineStateIdentity = z.infer<typeof timelineStateIdentitySchema>;

export const conversationTransitionKindSchema = z.enum([
  "entries_appended",
  "selection_changed",
  "context_boundary_committed",
  "interaction_changed",
  "run_changed",
  "execution_changed",
  "history_imported",
]);
export type ConversationTransitionKind = z.infer<
  typeof conversationTransitionKindSchema
>;

export const canonicalEntryKindSchema = z.enum([
  "user_message",
  "assistant_message",
  "tool_proposal",
  "tool_result",
  "child_result",
  "summary",
]);
export type CanonicalEntryKind = z.infer<typeof canonicalEntryKindSchema>;

export const artifactReferenceSchema = z.object({
  artifactId: z.string().startsWith("artifact_"),
  ownerKind: z.enum([
    "conversation",
    "entry",
    "execution_snapshot",
    "tool_attempt",
    "provider_attempt",
    "recovery_evidence",
  ]),
  ownerId: z.string().min(1).max(256),
  relativeLocator: z.string().min(1).max(2_048),
  digest,
  byteLength: safeInteger,
  mediaType: z.string().min(1).max(256),
  semanticRole: z.string().min(1).max(128),
  availability: z.enum(["prepared", "available", "missing", "corrupt"]),
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const canonicalConversationEntrySchema = z.object({
  schemaVersion: z.literal(1),
  entryId,
  conversationId,
  transitionId,
  ordinal: safeInteger,
  parentEntryId: entryId.nullable(),
  kind: canonicalEntryKindSchema,
  inlineContent: z.unknown().optional(),
  artifacts: z.array(artifactReferenceSchema).max(32).default([]),
  runId: z.string().startsWith("run_").optional(),
  toolCallId: z.string().min(1).max(256).optional(),
  interactionId: z.string().min(1).max(256).optional(),
  provenance: z.record(z.string(), z.unknown()).default({}),
});
export type CanonicalConversationEntry = z.infer<
  typeof canonicalConversationEntrySchema
>;

export const conversationHeadSchema = z.object({
  schemaVersion: z.literal(1),
  conversationId,
  revision: safeInteger,
  activeEntryId: entryId.nullable(),
  selectionEpoch: safeInteger,
  foregroundRunId: z.string().startsWith("run_").nullable(),
});
export type ConversationHead = z.infer<typeof conversationHeadSchema>;

export const conversationTransitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    transitionId,
    conversationId,
    revision: z.number().int().positive().safe(),
    kind: conversationTransitionKindSchema,
    commandId,
    inputFingerprint: digest,
    actor: z.record(z.string(), z.unknown()),
    cause: z.record(z.string(), z.unknown()),
    committedAt: z.string().datetime(),
    entries: z.array(canonicalConversationEntrySchema).max(64),
    evidenceReferences: z.array(z.string().min(1).max(256)).max(128),
    resultingHead: conversationHeadSchema,
  })
  .superRefine((value, context) => {
    if (
      value.resultingHead.conversationId !== value.conversationId ||
      value.resultingHead.revision !== value.revision
    ) {
      context.addIssue({
        code: "custom",
        message: "Resulting head must belong to the transition revision.",
        path: ["resultingHead"],
      });
    }
    const ordinals = new Set<number>();
    for (const [index, entry] of value.entries.entries()) {
      if (
        entry.conversationId !== value.conversationId ||
        entry.transitionId !== value.transitionId
      ) {
        context.addIssue({
          code: "custom",
          message: "Entry must belong to its containing transition.",
          path: ["entries", index],
        });
      }
      if (ordinals.has(entry.ordinal)) {
        context.addIssue({
          code: "custom",
          message: "Entry ordinal must be unique within a transition.",
          path: ["entries", index, "ordinal"],
        });
      }
      ordinals.add(entry.ordinal);
    }
  });
export type ConversationTransition = z.infer<
  typeof conversationTransitionSchema
>;

export const commandReceiptScopeSchema = z.object({
  namespaceId: z.string().startsWith("namespace_"),
  operationKind: z.string().min(1).max(128),
  ownerKind: z.enum(["state", "conversation", "policy_scope"]),
  ownerId: z.string().min(1).max(768),
  commandId,
});

export const canonicalCommandReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  scope: commandReceiptScopeSchema,
  fingerprintVersion: z.number().int().positive(),
  fingerprint: digest,
  outcomeVersion: z.number().int().positive(),
  outcome: z.unknown(),
  transitionReferences: z
    .array(
      z.object({
        conversationId,
        transitionId,
        revision: z.number().int().positive().safe(),
      }),
    )
    .max(64),
  createdAt: z.string().datetime(),
  contentRedactedAt: z.string().datetime().optional(),
});
export type CanonicalCommandReceipt = z.infer<
  typeof canonicalCommandReceiptSchema
>;

export const contextSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversationId,
    sourceTipEntryId: entryId.nullable(),
    entryCount: safeInteger,
    entriesManifest: artifactReferenceSchema,
    transitiveBoundaryCount: safeInteger,
    transitiveBoundariesManifest: artifactReferenceSchema.optional(),
    digest,
  })
  .superRefine((manifest, context) => {
    if (
      manifest.entriesManifest.ownerKind !== "conversation" ||
      manifest.entriesManifest.ownerId !== manifest.conversationId ||
      manifest.entriesManifest.availability !== "available" ||
      manifest.entriesManifest.semanticRole !== "context_source_manifest"
    ) {
      context.addIssue({
        code: "custom",
        path: ["entriesManifest"],
        message:
          "Context source manifest must be finalized and conversation-owned.",
      });
    }
    if (
      manifest.transitiveBoundariesManifest &&
      (manifest.transitiveBoundariesManifest.ownerKind !== "conversation" ||
        manifest.transitiveBoundariesManifest.ownerId !==
          manifest.conversationId ||
        manifest.transitiveBoundariesManifest.availability !== "available" ||
        manifest.transitiveBoundariesManifest.semanticRole !==
          "context_transitive_boundary_manifest")
    ) {
      context.addIssue({
        code: "custom",
        path: ["transitiveBoundariesManifest"],
        message:
          "Transitive boundary manifest must be finalized and conversation-owned.",
      });
    }
    if ((manifest.sourceTipEntryId === null) !== (manifest.entryCount === 0)) {
      context.addIssue({
        code: "custom",
        path: ["entryCount"],
        message: "A non-empty source has a tip and at least one entry.",
      });
    }
    if (
      manifest.transitiveBoundaryCount > 0 !==
      (manifest.transitiveBoundariesManifest !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["transitiveBoundariesManifest"],
        message:
          "Transitive boundary provenance requires a manifest exactly when non-empty.",
      });
    }
  });
export type ContextSourceManifest = z.infer<typeof contextSourceManifestSchema>;

export const contextBoundarySchema = z
  .object({
    schemaVersion: z.literal(1),
    boundaryId: z.string().startsWith("boundary_"),
    conversationId,
    transitionId,
    anchorEntryId: entryId.nullable(),
    sourceTipEntryId: entryId.nullable(),
    sourceManifest: contextSourceManifestSchema,
    policyVersion: z.number().int().positive(),
    providerAdapterVersion: z.string().min(1).max(128),
    recipeVersion: z.number().int().positive(),
    visibleSummaryEntryId: entryId.optional(),
  })
  .superRefine((boundary, context) => {
    if (
      boundary.sourceManifest.conversationId !== boundary.conversationId ||
      boundary.sourceManifest.sourceTipEntryId !== boundary.sourceTipEntryId
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceManifest"],
        message: "Source manifest must describe this boundary source.",
      });
    }
  });
export type ContextBoundary = z.infer<typeof contextBoundarySchema>;

export const projectionPositionSchema = z.object({
  canonicalRevision: safeInteger,
  appliedRevision: safeInteger,
  schemaVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  rebuildGeneration: z.number().int().positive(),
});

export const timelineViewDescriptorSchema = z.object({
  conversationId,
  sourceHeadEntryId: entryId.nullable(),
  sourceRevision: safeInteger,
  projection: projectionPositionSchema,
  visibilityId: z.string().min(1).max(128),
  filterId: z.string().min(1).max(128),
  ordering: z.enum([
    "ancestry_ascending",
    "tree_commit_order",
    "search_ancestry",
  ]),
  executionIncarnationId: z.string().startsWith("incarnation_"),
});
export type TimelineViewDescriptor = z.infer<
  typeof timelineViewDescriptorSchema
>;

export const canonicalAncestrySegmentSchema = z.object({
  conversationId,
  sourceEntryId: entryId,
  entries: z.array(canonicalConversationEntrySchema).max(512),
  nextAncestorEntryId: entryId.optional(),
  ordering: z.literal("ancestry_descending"),
});
export type CanonicalAncestrySegment = z.infer<
  typeof canonicalAncestrySegmentSchema
>;

export const timelinePageRequestSchema = z.object({
  conversationId,
  sourceHeadEntryId: entryId.nullable().optional(),
  minimumRevision: safeInteger.optional(),
  visibilityId: z.string().min(1).max(128).default("default"),
  filterId: z.string().min(1).max(128).default("transcript"),
  pageSize: z.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(8_192).optional(),
});
export type TimelinePageRequest = z.input<typeof timelinePageRequestSchema>;

export const timelineSearchRequestSchema = z.object({
  conversationId,
  query: z.string().trim().min(1).max(512),
  minimumRevision: safeInteger.optional(),
  visibilityId: z.string().min(1).max(128).default("default"),
  pageSize: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(8_192).optional(),
});
export type TimelineSearchRequest = z.input<typeof timelineSearchRequestSchema>;

export const transcriptProjectionStatusSchema = z.object({
  conversationId,
  appliedRevision: safeInteger,
  canonicalRevision: safeInteger,
  schemaVersion: z.number().int().positive().safe(),
  policyVersion: z.number().int().positive().safe(),
  rebuildGeneration: z.number().int().positive().safe(),
  rebuildState: z.enum(["ready", "rebuilding", "failed"]),
  oldestPendingAt: z.string().datetime().optional(),
  lastError: z.unknown().optional(),
});
export type TranscriptProjectionStatus = z.infer<
  typeof transcriptProjectionStatusSchema
>;

export const timelineTreePageRequestSchema = z.object({
  conversationId,
  sourceRevision: safeInteger.optional(),
  minimumRevision: safeInteger.optional(),
  visibilityId: z.string().min(1).max(128).default("default"),
  filterId: z.string().min(1).max(128).default("tree"),
  pageSize: z.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(8_192).optional(),
});
export type TimelineTreePageRequest = z.input<
  typeof timelineTreePageRequestSchema
>;

export const timelinePageSchema = z.object({
  view: timelineViewDescriptorSchema,
  entries: z.array(canonicalConversationEntrySchema).max(200),
  nextCursor: z.string().min(1).max(8_192).optional(),
  currentHead: conversationHeadSchema,
});
export type TimelinePage = z.infer<typeof timelinePageSchema>;

export const timelineTreePageSchema = z.object({
  view: timelineViewDescriptorSchema,
  entries: z.array(canonicalConversationEntrySchema).max(200),
  nextCursor: z.string().min(1).max(8_192).optional(),
  currentHead: conversationHeadSchema,
});
export type TimelineTreePage = z.infer<typeof timelineTreePageSchema>;
