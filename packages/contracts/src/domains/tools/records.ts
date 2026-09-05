import { z } from "zod";
import {
  durablePermissionSchema,
  permissionExceptionSchema,
  permissionRuleKindSchema,
  supervisionDecisionSchema,
  toolRiskSchema,
} from "../permissions/permissions.js";
import {
  permissionEvaluationResultSchema,
  permissionRuleSchema,
  permissionRuleSetIdSchema,
  permissionTargetKindSchema,
  staticToolRiskSchema,
  toolKindSchema,
} from "../permissions/permission-rule-sets.js";
import { recordedToolNameSchema, toolNameSchema } from "./tool-name.js";
import {
  agentPreviewSnapshotSchema,
  agentProjectionSnapshotSchema,
  validatedToolArtifactSchema,
} from "./tool-agent-projection.js";
export type {
  CoreToolName,
  OrchestrationToolName,
  RecordedToolName,
  ToolName,
  UserConfigurableToolName,
} from "./tool-name.js";
export {
  coreToolNameSchema,
  orchestrationToolNameSchema,
  recordedToolNameSchema,
  toolNameSchema,
  userConfigurableToolNameSchema,
} from "./tool-name.js";
import {
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
} from "../../events/bounded-public-data.js";

const toolCallTranscriptPreviewSchema = boundedPublicJsonSchema.transform(
  (value): unknown => value,
);
const toolCallTranscriptErrorDetailsSchema =
  boundedPublicObjectSchema.transform(
    (value): Record<string, unknown> => value,
  );

export const toolGroupNameSchema = z.enum([
  "fileInspection",
  "fileEditing",
  "shell",
  "python",
  "web",
  "vision",
  "jira",
  "confluence",
  "input",
  "todos",
  "taskManagement",
  "explore",
  "planMode",
]);
export type ToolGroupName = z.infer<typeof toolGroupNameSchema>;

export const toolExecutionKindSchema = z.enum(["local", "host"]);
export type ToolExecutionKind = z.infer<typeof toolExecutionKindSchema>;

export const toolTraitSchema = z.enum([
  "write_capable",
  "read_only_network",
  "long_running",
  "credentialed",
  "suspending",
]);
export type ToolTrait = z.infer<typeof toolTraitSchema>;

export const toolDescriptorSchema = z.object({
  name: toolNameSchema,
  kind: toolKindSchema,
  groups: z.array(z.string().trim().min(1).max(128)).min(1),
  baseRisk: staticToolRiskSchema,
  primaryArguments: z.array(z.string().trim().min(1).max(128)),
  targetKinds: z.array(permissionTargetKindSchema).min(1),
  /** @deprecated Use baseRisk. */
  risk: toolRiskSchema,
  argumentSensitive: z.boolean().default(false),
  description: z.string(),
  group: toolGroupNameSchema,
  executionKind: toolExecutionKindSchema,
  traits: z.array(toolTraitSchema),
  permission: z.object({
    ruleKind: permissionRuleKindSchema,
    durableAllow: durablePermissionSchema,
  }),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const toolCallStatusSchema = z.enum([
  "committed",
  "waiting",
  "running",
  "completed",
  "denied",
  "failed",
  "cancelled",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolPhaseSchema = z.enum([
  "drafting",
  "drafted",
  "executing",
  "completed",
  "failed",
  "denied",
  "cancelled",
  "interrupted",
]);
export type ToolPhase = z.infer<typeof toolPhaseSchema>;

export const supervisionStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
]);
export const supervisionDecisionSourceSchema = z.enum([
  "automatic",
  "user",
  "policy",
]);
export const toolExecutionStatusSchema = z.enum([
  "running",
  "waiting_for_input",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const durableToolSupervisionSchema = z.object({
  status: supervisionStatusSchema,
  source: supervisionDecisionSourceSchema.optional(),
  decision: supervisionDecisionSchema,
  decidedAt: z.string().datetime().optional(),
});
export type DurableToolSupervision = z.infer<
  typeof durableToolSupervisionSchema
>;

export const durableToolExecutionSchema = z.object({
  kind: toolExecutionKindSchema,
  status: toolExecutionStatusSchema,
  executionId: z.string().startsWith("exec_"),
  hostHandle: z.string().min(1).max(512).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});
export type DurableToolExecution = z.infer<typeof durableToolExecutionSchema>;

export const toolInteractionStatusSchema = z.enum([
  "pending",
  "resolved",
  "cancelled",
]);
export type ToolInteractionStatus = z.infer<typeof toolInteractionStatusSchema>;

const interactionBaseSchema = z.object({
  ordinal: z.number().int().nonnegative().safe(),
  status: toolInteractionStatusSchema,
  requestedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
  resolutionRequestId: z.string().min(1).max(256).optional(),
});

export const approvalToolInteractionSchema = interactionBaseSchema.extend({
  kind: z.literal("approval"),
  request: z.object({
    risk: toolRiskSchema,
    reason: z.string().min(1).max(4_096),
    normalizedArgs: boundedPublicObjectSchema.optional(),
    offeredScopes: z
      .array(
        z.enum([
          "single_call",
          "same_tool_same_args",
          "run",
          "always",
          "always_conversation",
          "always_project",
          "always_user",
        ]),
      )
      .max(7),
    suggestedExceptions: z.array(permissionExceptionSchema).max(16).default([]),
    suggestedRules: z.array(permissionRuleSchema).max(16).default([]),
    permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  }),
  resolution: z
    .object({
      action: z.enum(["allow", "deny"]),
      note: z.string().max(4_096).optional(),
      scope: z
        .enum([
          "single_call",
          "same_tool_same_args",
          "run",
          "always",
          "always_conversation",
          "always_project",
          "always_user",
        ])
        .optional(),
    })
    .optional(),
});

export const userInputToolInteractionSchema = interactionBaseSchema.extend({
  kind: z.literal("user_input"),
  request: z.object({
    question: z.string().min(1).max(16_000),
    context: z.string().max(16_000).optional(),
    recommendation: z.string().max(16_000).optional(),
    placeholder: z.string().max(1_000).optional(),
    required: z.boolean(),
  }),
  resolution: z
    .object({
      action: z.enum(["answer", "dismiss"]),
      answer: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const planReviewToolInteractionSchema = interactionBaseSchema.extend({
  kind: z.literal("plan_review"),
  request: z.object({
    planPath: z.string().min(1),
    slug: z.string().min(1).max(80),
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    allowNewConversation: z.boolean().default(true),
  }),
  resolution: z
    .object({
      action: z.enum([
        "accept",
        "accept_in_new_chat",
        "request_changes",
        "reject",
        "discard",
      ]),
      feedback: z.string().optional(),
      implementationModel: z.unknown().optional(),
      implementationThinkingLevel: z.string().optional(),
      compactBeforeImplementation: z.boolean().optional(),
    })
    .optional(),
});

export const toolInteractionSchema = z.discriminatedUnion("kind", [
  approvalToolInteractionSchema,
  userInputToolInteractionSchema,
  planReviewToolInteractionSchema,
]);
export type ToolInteraction = z.infer<typeof toolInteractionSchema>;
export type ApprovalToolInteraction = z.infer<
  typeof approvalToolInteractionSchema
>;
export type UserInputToolInteraction = z.infer<
  typeof userInputToolInteractionSchema
>;
export type PlanReviewToolInteraction = z.infer<
  typeof planReviewToolInteractionSchema
>;

export const toolCallErrorDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolCallErrorDetails = z.infer<typeof toolCallErrorDetailsSchema>;

export const toolResultPayloadReferenceSchema = z
  .object({
    version: z.literal(2),
    kind: z.literal("tool_result"),
    conversationId: z.string().startsWith("conv_").max(256),
    toolCallId: z.string().startsWith("tool_").max(256),
    logicalPath: z
      .string()
      .regex(/^conversations\/[^/]+\/tool-calls\/[^/]+\/result\.json$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative().safe(),
    mediaType: z.literal("application/json"),
    encoding: z.literal("utf-8"),
    completeness: z.enum(["complete", "legacy_bounded"]),
  })
  .strict();
export type ToolResultPayloadReference = z.infer<
  typeof toolResultPayloadReferenceSchema
>;

const toolCallRecordBaseSchema = z.object({
  id: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  toolName: recordedToolNameSchema,
  sourceToolCallId: z.string().min(1).optional(),
  providerToolCallId: z.string().min(1).optional(),
  runId: z.string().startsWith("run_").optional(),
  groupId: z.string().startsWith("group_").optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  contentIndex: z.number().int().nonnegative().optional(),
  risk: toolRiskSchema,
  args: z.unknown(),
  cwd: z.string().min(1),
  status: toolCallStatusSchema,
  /** Canonical lifecycle. `status` remains the bounded transcript projection. */
  phase: toolPhaseSchema.optional(),
  supervision: durableToolSupervisionSchema.optional(),
  /** Immutable generic permission evidence captured when the call was drafted. */
  permissionEvaluation: permissionEvaluationResultSchema.optional(),
  execution: durableToolExecutionSchema.optional(),
  revision: z.number().int().positive().safe(),
  attempt: z.number().int().nonnegative().safe(),
  interactions: z.array(toolInteractionSchema).max(16),
  hidden: z.boolean().optional(),
  result: z.unknown().optional(),
  resultPreview: toolCallTranscriptPreviewSchema.optional(),
  resultPayload: toolResultPayloadReferenceSchema.optional(),
  validatedArtifacts: z.array(validatedToolArtifactSchema).max(100).optional(),
  agentProjection: agentProjectionSnapshotSchema.optional(),
  agentPreview: agentPreviewSnapshotSchema.optional(),
  error: z.string().optional(),
  errorDetails: toolCallErrorDetailsSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  settledAt: z.string().datetime().optional(),
});

export const toolCallRecordSchema = toolCallRecordBaseSchema.superRefine(
  (record, context) => {
    if (
      record.resultPayload &&
      (record.resultPayload.conversationId !== record.conversationId ||
        record.resultPayload.toolCallId !== record.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tool-result payload ownership must match the tool call.",
        path: ["resultPayload"],
      });
    }
    const pending = record.interactions.filter(
      (interaction) => interaction.status === "pending",
    );
    if ((record.status === "waiting") !== (pending.length === 1)) {
      context.addIssue({
        code: "custom",
        message: "Waiting tool calls require exactly one pending interaction.",
      });
    }
    for (const [index, interaction] of record.interactions.entries()) {
      if (interaction.ordinal !== index) {
        context.addIssue({
          code: "custom",
          message: "Tool interaction ordinals must be contiguous and ordered.",
          path: ["interactions", index, "ordinal"],
        });
      }
      if (interaction.status === "resolved" && !interaction.resolution) {
        context.addIssue({
          code: "custom",
          message: "Resolved interactions require a resolution.",
          path: ["interactions", index],
        });
      }
    }
    const terminal = ["completed", "denied", "failed", "cancelled"].includes(
      record.status,
    );
    if (terminal && !record.settledAt)
      context.addIssue({
        code: "custom",
        message: "Terminal tool calls require settledAt.",
      });
  },
);
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

/**
 * Upgrades permission evidence stored before v0.27 without changing schemas or
 * checksum inputs for immutable conversation journal commits.
 */
export function normalizeLegacyToolCallRecord(
  record: ToolCallRecord,
): ToolCallRecord {
  const evaluation = record.permissionEvaluation;
  if (
    !evaluation ||
    Object.hasOwn(evaluation, "winningRuleSetId") ||
    Object.hasOwn(evaluation, "selectedRuleSetId")
  ) {
    return record;
  }
  const selectedRuleSetId = evaluation.activeRuleSetIds.at(-1);
  if (!selectedRuleSetId) return record;
  return {
    ...record,
    permissionEvaluation: {
      ...evaluation,
      winningRuleSetId:
        evaluation.winningRuleOrigin === "baseline"
          ? "baseline"
          : selectedRuleSetId,
      selectedRuleSetId,
    },
  };
}

export const toolCallPreviewOverflowSchema = z.object({
  hidden: z.number().int().nonnegative(),
  noun: z.string().min(1),
  direction: z.enum(["head", "tail", "mixed"]),
});
export type ToolCallPreviewOverflow = z.infer<
  typeof toolCallPreviewOverflowSchema
>;

/**
 * Lightweight tool-call row for transcript/history rendering. Full args/result
 * payloads are intentionally omitted and fetched on demand with GET
 * /api/tool-calls/:toolCallId.
 */
export const toolCallTranscriptRecordSchema = toolCallRecordBaseSchema
  .omit({
    args: true,
    result: true,
    resultPreview: true,
    resultPayload: true,
    validatedArtifacts: true,
    agentProjection: true,
    agentPreview: true,
    error: true,
    errorDetails: true,
  })
  .extend({
    argsPreview: toolCallTranscriptPreviewSchema.optional(),
    resultPreview: toolCallTranscriptPreviewSchema.optional(),
    error: z.string().max(2_048).optional(),
    errorDetails: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_048),
        retryable: z.boolean().optional(),
        details: toolCallTranscriptErrorDetailsSchema.optional(),
      })
      .optional(),
    previewOverflow: toolCallPreviewOverflowSchema.optional(),
  });
export type ToolCallTranscriptRecord = z.infer<
  typeof toolCallTranscriptRecordSchema
>;

export const approvalGrantScopeSchema = z.enum([
  "single_call",
  "always_conversation",
  "always_project",
  "always_user",
]);
export type ApprovalGrantScope = z.infer<typeof approvalGrantScopeSchema>;

export const approvalStatusSchema = z.enum(["pending", "granted", "denied"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRecordSchema = z.object({
  id: z.string().startsWith("approval_"),
  toolCallId: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  risk: toolRiskSchema,
  reason: z.string(),
  status: approvalStatusSchema,
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolutionNote: z.string().max(4_096).optional(),
  offeredScopes: z
    .array(approvalGrantScopeSchema)
    .max(4)
    .default(["single_call"]),
  suggestedExceptions: z.array(permissionExceptionSchema).max(16).default([]),
  suggestedRules: z.array(permissionRuleSchema).max(16).default([]),
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

export const userQuestionStatusSchema = z.enum([
  "pending",
  "answered",
  "dismissed",
]);
export type UserQuestionStatus = z.infer<typeof userQuestionStatusSchema>;

export const userQuestionRecordSchema = z.object({
  id: z.string().startsWith("question_"),
  toolCallId: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  question: z.string().min(1),
  context: z.string().optional(),
  recommendation: z.string().optional(),
  status: userQuestionStatusSchema,
  answer: z.string().optional(),
  dismissedReason: z.string().optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
});
export type UserQuestionRecord = z.infer<typeof userQuestionRecordSchema>;

export const answerUserQuestionRequestSchema = z.object({
  answer: z.string().min(1),
});
export type AnswerUserQuestionRequest = z.infer<
  typeof answerUserQuestionRequestSchema
>;

export const dismissUserQuestionRequestSchema = z.object({
  reason: z.string().optional(),
});
export type DismissUserQuestionRequest = z.infer<
  typeof dismissUserQuestionRequestSchema
>;

export const executeToolRequestSchema = z.object({
  toolName: toolNameSchema,
  args: z.record(z.string(), z.unknown()).default({}),
});
export type ExecuteToolRequest = z.infer<typeof executeToolRequestSchema>;

export const resolveApprovalRequestSchema = z.object({
  note: z.string().optional(),
});
export type ResolveApprovalRequest = z.infer<
  typeof resolveApprovalRequestSchema
>;
