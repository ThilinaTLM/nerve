import { z } from "zod";
import { promptImageSchema } from "../agents/prompt.js";

const isoDateTimeSchema = z.string().datetime();
const runIdSchema = z.string().startsWith("run_");
const conversationIdSchema = z.string().startsWith("conv_");
const agentIdSchema = z.string().startsWith("agent_");
const projectIdSchema = z.string().startsWith("proj_");
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const lifecycleStateSchema = z.enum([
  "open",
  "completed",
  "cancelled",
  "failed",
]);
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export const runExecutionPhaseSchema = z.enum([
  "awaiting_input",
  "executing_tools",
  "continuation_ready",
  "model_running",
  "reconciling",
  "recovery_required",
  "idle",
]);
export type RunExecutionPhase = z.infer<typeof runExecutionPhaseSchema>;

export const replayCapabilitySchema = z.enum([
  "safe_replay",
  "idempotency_key",
  "reattach_or_query",
  "non_replayable",
]);
export type ReplayCapability = z.infer<typeof replayCapabilitySchema>;

export const lifecycleInteractionKindSchema = z.enum([
  "approval",
  "user_input",
  "plan_review",
]);

export const lifecycleInteractionSchema = z.object({
  id: z.string().min(1).max(256),
  proposalId: z.string().min(1).max(256),
  runId: runIdSchema,
  kind: lifecycleInteractionKindSchema,
  status: z.enum(["pending", "resolved", "cancelled"]),
  request: z.record(z.string(), z.unknown()),
  resolution: z.record(z.string(), z.unknown()).optional(),
  resolutionRequestId: z.string().min(1).max(256).optional(),
  resolutionHash: sha256Schema.optional(),
  requestedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  cancelledAt: isoDateTimeSchema.optional(),
});
export type LifecycleInteraction = z.infer<typeof lifecycleInteractionSchema>;

export const toolProposalSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: conversationIdSchema,
  projectId: projectIdSchema,
  agentId: agentIdSchema,
  runId: runIdSchema,
  executionId: z.string().startsWith("exec_"),
  batchId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  providerToolCallId: z.string().min(1).max(256),
  argumentsHash: sha256Schema,
  contextFingerprint: sha256Schema,
  replayCapability: replayCapabilitySchema,
  createdAt: isoDateTimeSchema,
});
export type ToolProposal = z.infer<typeof toolProposalSchema>;

export const executionAttemptStateSchema = z.enum([
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
  "outcome_unknown",
]);
export type ExecutionAttemptState = z.infer<typeof executionAttemptStateSchema>;

export const executionAttemptSchema = z.object({
  id: z.string().min(1).max(256),
  proposalId: z.string().min(1).max(256),
  runId: runIdSchema,
  generation: z.number().int().nonnegative().safe(),
  state: executionAttemptStateSchema,
  resultEntryId: z.string().min(1).max(256).optional(),
  resultRef: z.string().min(1).max(1_024).optional(),
  externalLocator: z.string().min(1).max(1_024).optional(),
  startedAt: isoDateTimeSchema.optional(),
  settledAt: isoDateTimeSchema.optional(),
});
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;

export const lifecycleWorkKindSchema = z.enum([
  "execute_tool",
  "continue_model",
  "reconcile_conversation",
]);
export type LifecycleWorkKind = z.infer<typeof lifecycleWorkKindSchema>;

export const lifecycleWorkStateSchema = z.enum([
  "ready",
  "leased",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
]);
export type LifecycleWorkState = z.infer<typeof lifecycleWorkStateSchema>;

export const lifecycleWorkSchema = z.object({
  id: z.string().startsWith("work_"),
  deduplicationKey: z.string().min(1).max(512),
  conversationId: conversationIdSchema,
  runId: runIdSchema.optional(),
  proposalId: z.string().min(1).max(256).optional(),
  kind: lifecycleWorkKindSchema,
  state: lifecycleWorkStateSchema,
  inputHash: sha256Schema,
  generation: z.number().int().nonnegative().safe(),
  attemptCount: z.number().int().nonnegative().safe(),
  notBefore: isoDateTimeSchema,
  leaseOwner: z.string().min(1).max(256).optional(),
  leaseDeadline: isoDateTimeSchema.optional(),
  externalLocator: z.string().min(1).max(1_024).optional(),
  modelRequest: z
    .discriminatedUnion("command", [
      z.object({
        command: z.literal("start"),
        prompt: z.string().min(1),
        images: z.array(promptImageSchema).max(16).optional(),
        replayCapability: replayCapabilitySchema,
      }),
      z.object({
        command: z.literal("continue"),
        replayCapability: replayCapabilitySchema,
      }),
    ])
    .optional(),
  lastError: z.string().max(2_000).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type LifecycleWork = z.infer<typeof lifecycleWorkSchema>;

export const recoveryIssueSchema = z.object({
  id: z.string().startsWith("recovery_"),
  conversationId: conversationIdSchema,
  runId: runIdSchema.optional(),
  workId: z.string().startsWith("work_").optional(),
  code: z.enum([
    "outcome_unknown",
    "invalid_checkpoint",
    "missing_artifact",
    "conflicting_state",
    "stale_branch",
  ]),
  message: z.string().min(1).max(2_000),
  actions: z.array(z.enum(["inspect", "cancel_run", "authorize_retry"])).max(3),
  createdAt: isoDateTimeSchema,
});
export type RecoveryIssue = z.infer<typeof recoveryIssueSchema>;

export const runLifecycleRecordSchema = z.object({
  runId: runIdSchema,
  conversationId: conversationIdSchema,
  projectId: projectIdSchema,
  agentId: agentIdSchema,
  branchEpoch: z.number().int().positive().safe(),
  revision: z.number().int().positive().safe(),
  state: lifecycleStateSchema,
  currentBatchId: z.string().min(1).max(256).optional(),
  currentModelAttemptId: z.string().min(1).max(256).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  terminalAt: isoDateTimeSchema.optional(),
});
export type RunLifecycleRecord = z.infer<typeof runLifecycleRecordSchema>;

export const runActivityViewSchema = z.object({
  runId: runIdSchema,
  conversationId: conversationIdSchema,
  revision: z.number().int().positive().safe(),
  lifecycleState: lifecycleStateSchema,
  phase: runExecutionPhaseSchema,
  actionableInteractions: z.array(lifecycleInteractionSchema),
  recoveryIssues: z.array(recoveryIssueSchema),
  readyWorkCount: z.number().int().nonnegative().safe(),
  leasedWorkCount: z.number().int().nonnegative().safe(),
});
export type RunActivityView = z.infer<typeof runActivityViewSchema>;
