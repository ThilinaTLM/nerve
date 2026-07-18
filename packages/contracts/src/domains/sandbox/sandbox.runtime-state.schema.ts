import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/index.js";
import { planReviewRecordSchema } from "../plans/index.js";
import {
  artifactRefSchema,
  boundedTextSchema,
  contextFileStatusSchema,
  controllerConnectivityStatusSchema,
  isoDateTimeSchema,
  networkPolicyStatusSchema,
  redactedErrorSchema,
  sandboxAgentIdSchema,
  sandboxConversationIdSchema,
  sandboxRunIdSchema,
  sandboxRunStatusSchema,
  secretStoreStatusSchema,
  skillStatusSchema,
  startupSetupStatusSchema,
  toolGroupStatusSchema,
} from "./sandbox.common.schema.js";

export const sandboxOutboxRecordSchema = z.object({
  seq: z.number().int().positive().safe(),
  id: z.string().min(1),
  ts: isoDateTimeSchema,
  type: z.string().min(1),
  delivery: z.literal("sequenced"),
  data: z.unknown(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxOutboxRecord = z.infer<typeof sandboxOutboxRecordSchema>;

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
  requestId: z.string().min(1).optional(),
  status: sandboxRunStatusSchema,
  promptSummary: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  terminalAt: isoDateTimeSchema.optional(),
  error: redactedErrorSchema.optional(),
  lastCheckpointId: z.string().min(1).optional(),
  recoverability: z
    .enum(["not_needed", "checkpoint", "retryable", "manual", "none"])
    .optional(),
  terminalReason: z.string().min(1).optional(),
});
export type SandboxRunStateRecord = z.infer<typeof sandboxRunStateRecordSchema>;

export const sandboxRunExecutionRecordSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  executionId: z.string().min(1),
  attempt: z.number().int().positive().safe().default(1),
  providerRequestId: z.string().min(1).optional(),
  abortRef: z.string().min(1).optional(),
  lastCheckpointId: z.string().min(1).optional(),
  recoverability: z.enum(["checkpoint", "retryable", "manual", "none"]),
  status: z.enum([
    "starting",
    "streaming",
    "waiting",
    "completed",
    "failed",
    "cancelled",
    "superseded",
  ]),
  startedAt: isoDateTimeSchema,
  lastDeltaAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  terminalReason: z.string().min(1).optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxRunExecutionRecord = z.infer<
  typeof sandboxRunExecutionRecordSchema
>;

export const sandboxTranscriptEntrySchema = z.object({
  entryId: z.string().min(1),
  index: z.number().int().nonnegative().safe(),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: boundedTextSchema,
  details: z.unknown().optional(),
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
  status: z.enum([
    "requested",
    "waiting_for_input",
    "waiting_for_approval",
    "started",
    "completed",
    "failed",
    "cancelled",
  ]),
  args: z.unknown().optional(),
  displayArgs: z.unknown().optional(),
  artifactRefs: z.array(artifactRefSchema).optional(),
  approvalId: z.string().min(1).optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  contentIndex: z.number().int().nonnegative().safe().optional(),
  lifecycleSeq: z.number().int().nonnegative().safe().optional(),
  redactionVersion: z.number().int().nonnegative().safe().optional(),
  result: z.unknown().optional(),
  error: redactedErrorSchema.optional(),
  requestedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
});
export type SandboxToolCallRecord = z.infer<typeof sandboxToolCallRecordSchema>;

export const sandboxWaitResolutionRecordSchema = z.object({
  waitId: z.string().min(1),
  kind: z.enum(["input", "approval"]),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  resolutionRequestId: z.string().min(1).optional(),
  decisionHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  status: z.enum(["submitted", "granted", "denied", "cancelled", "expired"]),
  resolvedAt: isoDateTimeSchema,
  checkpointId: z.string().min(1).optional(),
  transcriptEntryId: z.string().min(1).optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxWaitResolutionRecord = z.infer<
  typeof sandboxWaitResolutionRecordSchema
>;

export const sandboxPlanReviewDecisionSchema = z.enum([
  "accept",
  "request_changes",
  "discard",
]);
export type SandboxPlanReviewDecision = z.infer<
  typeof sandboxPlanReviewDecisionSchema
>;

export const sandboxPlanReviewWaitRecordSchema = z.object({
  review: planReviewRecordSchema,
  providerToolCallId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  status: z.enum([
    "pending",
    "accepted",
    "changes_requested",
    "discarded",
    "force_exited",
  ]),
  decision: sandboxPlanReviewDecisionSchema.optional(),
  feedback: z.string().optional(),
  implementationModel: modelSelectionSchema.optional(),
  implementationThinkingLevel: thinkingLevelSchema.optional(),
  resolutionRequestId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  toolResultEntryId: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
});
export type SandboxPlanReviewWaitRecord = z.infer<
  typeof sandboxPlanReviewWaitRecordSchema
>;

export const sandboxInputWaitRecordSchema = z.object({
  requestId: z.string().min(1),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  question: boundedTextSchema,
  context: z.string().optional(),
  recommendation: z.string().optional(),
  placeholder: z.string().optional(),
  status: z.enum(["waiting", "submitted", "cancelled", "expired"]),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.optional(),
  resolvedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
  resumeRequestId: z.string().min(1).optional(),
  toolResultEntryId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  redactedDisplay: boundedTextSchema.optional(),
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
  displayArgs: z.unknown().optional(),
  status: z.enum(["waiting", "granted", "denied", "cancelled", "expired"]),
  selectedScope: z
    .enum(["single_call", "same_tool_same_args", "run"])
    .optional(),
  resolutionRequestId: z.string().min(1).optional(),
  resolutionReason: z.string().min(1).optional(),
  appliesTo: z.array(z.string().min(1)).optional(),
  checkpointId: z.string().min(1).optional(),
  denialError: redactedErrorSchema.optional(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
});
export type SandboxApprovalWaitRecord = z.infer<
  typeof sandboxApprovalWaitRecordSchema
>;

export const sandboxTaskRecordSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).optional(),
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  status: z.enum([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    "orphaned",
  ]),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  exitCode: z.number().int().safe().optional(),
  signal: z.string().min(1).optional(),
  timeoutAt: isoDateTimeSchema.optional(),
  maxRuntimeMs: z.number().int().positive().safe().optional(),
  logRef: z.string().min(1).optional(),
  logBytes: z.number().int().nonnegative().safe().optional(),
  truncated: z.boolean().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  error: redactedErrorSchema.optional(),
});
export type SandboxTaskRecord = z.infer<typeof sandboxTaskRecordSchema>;

export const sandboxTaskLogCursorSchema = z.object({
  taskId: z.string().min(1),
  cursor: z.string().min(1),
  offset: z.number().int().nonnegative().safe().optional(),
  line: z.number().int().nonnegative().safe().optional(),
  bytes: z.number().int().nonnegative().safe().optional(),
  complete: z.boolean().optional(),
  updatedAt: isoDateTimeSchema,
});
export type SandboxTaskLogCursor = z.infer<typeof sandboxTaskLogCursorSchema>;

export const sandboxControllerSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  instanceId: z.string().min(1),
  status: z.enum(["connected", "disconnected", "closed"]),
  acceptedCapabilities: z.array(z.string().min(1)).optional(),
  connectedAt: isoDateTimeSchema,
  lastHeartbeatAt: isoDateTimeSchema.optional(),
  disconnectedAt: isoDateTimeSchema.optional(),
  closeCode: z.number().int().safe().optional(),
  closeReason: z.string().min(1).optional(),
  reconnectAttempts: z.number().int().nonnegative().safe().optional(),
  lastError: redactedErrorSchema.optional(),
  queue: z
    .object({
      pendingBatches: z.number().int().nonnegative().safe().optional(),
      pendingEvents: z.number().int().nonnegative().safe().optional(),
      pendingBytes: z.number().int().nonnegative().safe().optional(),
    })
    .optional(),
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
  childRunId: sandboxRunIdSchema.optional(),
  relationship: z.enum(["explore", "subagent"]),
  depth: z.number().int().nonnegative().safe().optional(),
  label: z.string().min(1).optional(),
  status: z
    .enum(["queued", "running", "completed", "failed", "cancelled"])
    .optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema.optional(),
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
  format: z.literal("nerve-sandbox-agent-state"),
  version: z.literal(4),
  initializedAt: isoDateTimeSchema,
});
export type SandboxStateLayoutVersion = z.infer<
  typeof sandboxStateLayoutVersionSchema
>;
