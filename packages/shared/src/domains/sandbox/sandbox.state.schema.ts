import { z } from "zod";
import {
  boundedTextSchema,
  contextFileStatusSchema,
  controllerConnectivityStatusSchema,
  isoDateTimeSchema,
  networkPolicyStatusSchema,
  redactedErrorSchema,
  sandboxAgentIdSchema,
  sandboxCommandIdSchema,
  sandboxConversationIdSchema,
  sandboxRunIdSchema,
  sandboxRunStatusSchema,
  secretStoreStatusSchema,
  skillStatusSchema,
  startupSetupStatusSchema,
  toolGroupStatusSchema,
} from "./sandbox.common.schema.js";

export const sandboxOutboxRecordSchema = z.object({
  seq: z.number().int().nonnegative().safe(),
  id: z.string().min(1),
  ts: isoDateTimeSchema,
  type: z.string().min(1),
  durability: z.enum(["durable", "transient"]),
  data: z.unknown(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
  sentAt: isoDateTimeSchema.optional(),
  ackedAt: isoDateTimeSchema.optional(),
});
export type SandboxOutboxRecord = z.infer<typeof sandboxOutboxRecordSchema>;

export const sandboxCommandRecordSchema = z.object({
  commandId: sandboxCommandIdSchema,
  messageId: z.string().min(1),
  method: z.string().min(1),
  paramsHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  params: z.unknown(),
  acceptedAt: isoDateTimeSchema,
  status: z.enum([
    "accepted",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]),
  recoveryStatus: z
    .enum(["not_needed", "requeued", "marked_failed", "marked_cancelled"])
    .optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxCommandRecord = z.infer<typeof sandboxCommandRecordSchema>;

export const sandboxCommandDecisionRecordSchema = z.object({
  commandId: sandboxCommandIdSchema,
  method: z.string().min(1).optional(),
  paramsHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  decision: z.enum([
    "accepted",
    "duplicate",
    "conflict",
    "rejected",
    "completed",
    "failed",
    "cancelled",
    "recovered",
  ]),
  reason: z.string().min(1).optional(),
  resultRef: z.string().min(1).optional(),
  decidedAt: isoDateTimeSchema,
  error: redactedErrorSchema.optional(),
});
export type SandboxCommandDecisionRecord = z.infer<
  typeof sandboxCommandDecisionRecordSchema
>;

export const sandboxCommandResultRecordSchema = z.object({
  commandId: sandboxCommandIdSchema,
  method: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  result: z.unknown().optional(),
  error: redactedErrorSchema.optional(),
  completedAt: isoDateTimeSchema,
  responseHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
});
export type SandboxCommandResultRecord = z.infer<
  typeof sandboxCommandResultRecordSchema
>;

export const sandboxConversationStateSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  title: z.string().min(1).optional(),
  agentIds: z.array(sandboxAgentIdSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SandboxConversationState = z.infer<
  typeof sandboxConversationStateSchema
>;

export const sandboxAgentStateSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  model: z
    .object({ provider: z.string().min(1), model: z.string().min(1) })
    .optional(),
  permissionLevel: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SandboxAgentState = z.infer<typeof sandboxAgentStateSchema>;

export const sandboxRunStateRecordSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  commandId: sandboxCommandIdSchema.optional(),
  status: sandboxRunStatusSchema,
  promptSummary: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  terminalAt: isoDateTimeSchema.optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxRunStateRecord = z.infer<typeof sandboxRunStateRecordSchema>;

export const sandboxTranscriptEntrySchema = z.object({
  entryId: z.string().min(1),
  index: z.number().int().nonnegative().safe(),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: boundedTextSchema,
  createdAt: isoDateTimeSchema,
});
export type SandboxTranscriptEntry = z.infer<
  typeof sandboxTranscriptEntrySchema
>;

export const sandboxToolCallRecordSchema = z.object({
  toolCallId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  toolName: z.string().min(1),
  status: z.enum(["requested", "started", "completed", "failed"]),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  error: redactedErrorSchema.optional(),
  requestedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
});
export type SandboxToolCallRecord = z.infer<typeof sandboxToolCallRecordSchema>;

export const sandboxInputWaitRecordSchema = z.object({
  requestId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  question: boundedTextSchema,
  placeholder: z.string().optional(),
  status: z.enum(["waiting", "submitted", "cancelled"]),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  response: boundedTextSchema.optional(),
});
export type SandboxInputWaitRecord = z.infer<
  typeof sandboxInputWaitRecordSchema
>;

export const sandboxApprovalWaitRecordSchema = z.object({
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  risk: z.array(z.string().min(1)),
  reason: z.string().min(1),
  normalizedArgs: z.unknown(),
  status: z.enum(["waiting", "granted", "denied", "cancelled"]),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
});
export type SandboxApprovalWaitRecord = z.infer<
  typeof sandboxApprovalWaitRecordSchema
>;

export const sandboxControllerSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  instanceId: z.string().min(1),
  status: z.enum(["connected", "disconnected", "closed"]),
  connectedAt: isoDateTimeSchema,
  disconnectedAt: isoDateTimeSchema.optional(),
  closeCode: z.number().int().safe().optional(),
  closeReason: z.string().min(1).optional(),
  cursors: z
    .array(
      z.object({
        stream: z.string().min(1),
        processedSeq: z.number().int().nonnegative().safe(),
      }),
    )
    .optional(),
});
export type SandboxControllerSessionRecord = z.infer<
  typeof sandboxControllerSessionRecordSchema
>;

export const sandboxAckStateSchema = z.object({
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      processedSeq: z.number().int().nonnegative().safe(),
    }),
  ),
  updatedAt: isoDateTimeSchema,
});
export type SandboxAckState = z.infer<typeof sandboxAckStateSchema>;

export const sandboxCheckpointRecordSchema = z.object({
  checkpointId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  status: sandboxRunStatusSchema,
  createdAt: isoDateTimeSchema,
  transcriptSeq: z.number().int().nonnegative().safe().optional(),
  toolCallIds: z.array(z.string().min(1)).optional(),
  stateRef: z.string().min(1).optional(),
  summary: boundedTextSchema.optional(),
});
export type SandboxCheckpointRecord = z.infer<
  typeof sandboxCheckpointRecordSchema
>;

export const sandboxCredentialStatusRecordSchema = z.object({
  provider: z.string().min(1),
  group: z.string().min(1).optional(),
  credentialType: z.string().min(1),
  status: z.enum([
    "available",
    "unavailable",
    "expired",
    "refreshing",
    "failed",
    "skipped",
  ]),
  expiresAt: isoDateTimeSchema.optional(),
  persisted: z.enum(["state", "file", "none", "not_applicable"]).optional(),
  updatedAt: isoDateTimeSchema,
  error: redactedErrorSchema.optional(),
});
export type SandboxCredentialStatusRecord = z.infer<
  typeof sandboxCredentialStatusRecordSchema
>;

export const sandboxCredentialStatusFileSchema = z.object({
  credentials: z.array(sandboxCredentialStatusRecordSchema),
  updatedAt: isoDateTimeSchema,
});
export type SandboxCredentialStatusFile = z.infer<
  typeof sandboxCredentialStatusFileSchema
>;

export const sandboxSecretStoreStatusFileSchema = z.object({
  stores: z.array(secretStoreStatusSchema),
  updatedAt: isoDateTimeSchema,
});
export type SandboxSecretStoreStatusFile = z.infer<
  typeof sandboxSecretStoreStatusFileSchema
>;

export const sandboxSecretStoreCacheMetadataSchema = z.object({
  storeId: z.string().min(1),
  entries: z.number().int().nonnegative().safe(),
  maxEntries: z.number().int().nonnegative().safe().optional(),
  ttlMs: z.number().int().nonnegative().safe().optional(),
  updatedAt: isoDateTimeSchema,
});
export type SandboxSecretStoreCacheMetadata = z.infer<
  typeof sandboxSecretStoreCacheMetadataSchema
>;

export const sandboxSetupStatusFileSchema = z.object({
  git: startupSetupStatusSchema.optional(),
  github: startupSetupStatusSchema.optional(),
  boot: startupSetupStatusSchema.optional(),
  skills: startupSetupStatusSchema.optional(),
  updatedAt: isoDateTimeSchema,
});
export type SandboxSetupStatusFile = z.infer<
  typeof sandboxSetupStatusFileSchema
>;

export const sandboxSkillContextFileSchema = z.object({
  contextFiles: z.array(contextFileStatusSchema),
  updatedAt: isoDateTimeSchema,
});
export type SandboxSkillContextFile = z.infer<
  typeof sandboxSkillContextFileSchema
>;

export const sandboxSkillLoadedFileSchema = z.object({
  skills: z.array(skillStatusSchema),
  updatedAt: isoDateTimeSchema,
});
export type SandboxSkillLoadedFile = z.infer<
  typeof sandboxSkillLoadedFileSchema
>;

export const sandboxSkillDiagnosticRecordSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string().min(1),
  path: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
});
export type SandboxSkillDiagnosticRecord = z.infer<
  typeof sandboxSkillDiagnosticRecordSchema
>;

export const sandboxControllerConnectivityRecordSchema =
  controllerConnectivityStatusSchema.extend({ updatedAt: isoDateTimeSchema });
export type SandboxControllerConnectivityRecord = z.infer<
  typeof sandboxControllerConnectivityRecordSchema
>;

export const sandboxAgentRelationshipRecordSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  parentAgentId: sandboxAgentIdSchema,
  childAgentId: sandboxAgentIdSchema,
  parentRunId: sandboxRunIdSchema.optional(),
  relationship: z.enum(["explore", "subagent"]),
  createdAt: isoDateTimeSchema,
  summary: boundedTextSchema.optional(),
});
export type SandboxAgentRelationshipRecord = z.infer<
  typeof sandboxAgentRelationshipRecordSchema
>;

export const sandboxProtectedStateSummarySchema = z.object({
  credentials: z.array(sandboxCredentialStatusRecordSchema).optional(),
  secretStores: z.array(secretStoreStatusSchema).optional(),
  setup: sandboxSetupStatusFileSchema.optional(),
  connectivity: sandboxControllerConnectivityRecordSchema.optional(),
  network: networkPolicyStatusSchema.optional(),
  toolGroups: z.array(toolGroupStatusSchema).optional(),
  updatedAt: isoDateTimeSchema,
});
export type SandboxProtectedStateSummary = z.infer<
  typeof sandboxProtectedStateSummarySchema
>;

export const sandboxStateLayoutVersionSchema = z.object({
  format: z.literal("nerve-sandbox-state"),
  version: z.literal(1),
  initializedAt: isoDateTimeSchema,
});
export type SandboxStateLayoutVersion = z.infer<
  typeof sandboxStateLayoutVersionSchema
>;
