import { z } from "zod";
import { queuedPromptRecordSchema } from "../agents/agent.schema.js";
import { conversationEntrySchema } from "../conversations/tree.schema.js";
import { publicEventNameSchema } from "../events/public-event-catalog.schema.js";
import { planReviewRecordSchema } from "../plans/plan-review.schema.js";
import { toolCallTranscriptRecordSchema } from "../tools/records.schema.js";

const isoDateTimeSchema = z.string().datetime();
const runIdSchema = z.string().startsWith("run_");
const conversationIdSchema = z.string().startsWith("conv_");
const agentIdSchema = z.string().startsWith("agent_");
const projectIdSchema = z.string().startsWith("proj_");
const executionIdSchema = z.string().startsWith("exec_");
const interactionIdSchema = z.string().min(1).max(256);
const checkpointIdSchema = z.string().startsWith("checkpoint_");
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const RUN_STATE_EPOCH = 1 as const;

export const runRuntimeStatusSchema = z.enum([
  "starting",
  "running",
  "retrying",
  "waiting",
  "suspended",
  "cancellation_requested",
  "cancellation_failed",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]);
export type RunRuntimeStatus = z.infer<typeof runRuntimeStatusSchema>;

export const runRecoverabilitySchema = z.enum([
  "not_needed",
  "checkpoint",
  "retryable",
  "manual",
  "none",
]);
export type RunRecoverability = z.infer<typeof runRecoverabilitySchema>;

export const runFailureSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
});
export type RunFailureRecord = z.infer<typeof runFailureSchema>;

export const runCancellationEvidenceSchema = z.object({
  target: z.enum(["model", "tool", "task", "subagent", "interaction"]),
  status: z.enum(["pending", "confirmed", "not_running", "failed"]),
  checkedAt: isoDateTimeSchema,
  message: z.string().max(500).optional(),
});
export type RunCancellationEvidence = z.infer<
  typeof runCancellationEvidenceSchema
>;

export const runRecordSchema = z.object({
  stateEpoch: z.literal(RUN_STATE_EPOCH),
  conversationId: conversationIdSchema,
  agentId: agentIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  scopeId: z.string().min(1).max(768),
  revision: z.number().int().positive().safe(),
  status: runRuntimeStatusSchema,
  recoverability: runRecoverabilitySchema,
  executionId: executionIdSchema,
  attempt: z.number().int().positive().safe(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  terminalAt: isoDateTimeSchema.optional(),
  activeInteractionId: interactionIdSchema.optional(),
  lastCheckpointId: checkpointIdSchema.optional(),
  cancellationEvidence: z.array(runCancellationEvidenceSchema).max(16),
  failure: runFailureSchema.optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const runExecutionRecordSchema = z.object({
  stateEpoch: z.literal(RUN_STATE_EPOCH),
  conversationId: conversationIdSchema,
  agentId: agentIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  executionId: executionIdSchema,
  attempt: z.number().int().positive().safe(),
  status: z.enum([
    "starting",
    "streaming",
    "waiting",
    "completed",
    "failed",
    "cancelled",
    "superseded",
  ]),
  recoverability: runRecoverabilitySchema,
  startedAt: isoDateTimeSchema,
  providerBoundary: z
    .enum([
      "before_request",
      "after_response",
      "after_tool_result",
      "suspended",
    ])
    .optional(),
  lastCheckpointId: checkpointIdSchema.optional(),
  lastDeltaAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  failure: runFailureSchema.optional(),
});
export type RunExecutionRecord = z.infer<typeof runExecutionRecordSchema>;

const runInteractionBaseSchema = z.object({
  stateEpoch: z.literal(RUN_STATE_EPOCH),
  id: interactionIdSchema,
  conversationId: conversationIdSchema,
  agentId: agentIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  executionId: executionIdSchema,
  toolCallId: z.string().min(1).max(256),
  prompt: z.string().min(1).max(16_000),
  context: z.string().max(16_000).optional(),
  status: z.enum(["pending", "resolved", "cancelled"]),
  resolutionRequestId: z.string().min(1).max(256).optional(),
  resolutionHash: sha256Schema.optional(),
  resolution: z.record(z.string(), z.unknown()).optional(),
  checkpointId: checkpointIdSchema,
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
});

export const runInteractionRecordSchema = z.discriminatedUnion("kind", [
  runInteractionBaseSchema.extend({
    kind: z.literal("question"),
    placeholder: z.string().max(1_000).optional(),
    required: z.boolean(),
  }),
  runInteractionBaseSchema.extend({
    kind: z.literal("approval"),
    risk: z.array(z.string().min(1).max(256)).max(64),
    normalizedArgs: z.record(z.string(), z.unknown()),
    offeredScopes: z
      .array(z.enum(["single_call", "same_tool_same_args", "run"]))
      .max(3),
  }),
  runInteractionBaseSchema.extend({
    kind: z.literal("plan_review"),
    planReview: planReviewRecordSchema,
  }),
]);
export type RunInteractionRecord = z.infer<typeof runInteractionRecordSchema>;

export const runCheckpointRecordSchema = z.object({
  stateEpoch: z.literal(RUN_STATE_EPOCH),
  checkpointId: checkpointIdSchema,
  parentCheckpointId: checkpointIdSchema.optional(),
  conversationId: conversationIdSchema,
  agentId: agentIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  executionId: executionIdSchema,
  attempt: z.number().int().positive().safe(),
  boundary: z.enum([
    "before_provider_request",
    "after_provider_response",
    "after_tool_result",
    "suspension",
  ]),
  transcriptCursor: z.number().int().nonnegative().safe(),
  entryIds: z.array(z.string().startsWith("entry_")).max(100_000),
  harnessLeafId: z.string().min(1).max(256).nullable(),
  harnessSavePointId: z.string().min(1).max(256),
  toolCalls: z
    .array(
      z.object({
        toolCallId: z.string().min(1).max(256),
        lifecycleRevision: z.number().int().nonnegative().safe(),
      }),
    )
    .max(10_000),
  interactionId: interactionIdSchema.optional(),
  createdAt: isoDateTimeSchema,
  committed: z.literal(true),
  checksum: sha256Schema,
});
export type RunCheckpointRecord = z.infer<typeof runCheckpointRecordSchema>;

export const runPromptRecordSchema = queuedPromptRecordSchema.extend({
  ordinal: z.number().int().nonnegative().safe(),
  deliveryAttempts: z.number().int().nonnegative().safe(),
});
export type RunPromptRecord = z.infer<typeof runPromptRecordSchema>;

export const runPublicEventIntentSchema = z.object({
  id: z.string().min(1).max(512),
  type: publicEventNameSchema,
  durability: z.enum(["durable", "transient"]),
  occurredAt: isoDateTimeSchema,
  data: z.unknown(),
});
export type RunPublicEventIntent = z.infer<typeof runPublicEventIntentSchema>;

export const runTransitionRecordSchema = z.object({
  stateEpoch: z.literal(RUN_STATE_EPOCH),
  transitionId: z.string().startsWith("transition_"),
  runId: runIdSchema,
  scopeId: z.string().min(1).max(768),
  revision: z.number().int().positive().safe(),
  previousRevision: z.number().int().nonnegative().safe(),
  kind: z.string().min(1).max(128),
  committedAt: isoDateTimeSchema,
  run: runRecordSchema,
  execution: runExecutionRecordSchema.optional(),
  prompts: z.array(runPromptRecordSchema),
  interactions: z.array(runInteractionRecordSchema),
  checkpoints: z.array(runCheckpointRecordSchema),
  entries: z.array(conversationEntrySchema),
  toolCalls: z.array(toolCallTranscriptRecordSchema),
  events: z.array(runPublicEventIntentSchema),
  checksum: sha256Schema,
});
export type RunTransitionRecord = z.infer<typeof runTransitionRecordSchema>;

export const runEventDeliveryRecordSchema = z.object({
  intentId: z.string().min(1).max(512),
  runId: runIdSchema,
  revision: z.number().int().positive().safe(),
  eventId: z.string().min(1).max(256),
  sequence: z.number().int().nonnegative().safe(),
  deliveredAt: isoDateTimeSchema,
});
export type RunEventDeliveryRecord = z.infer<
  typeof runEventDeliveryRecordSchema
>;
