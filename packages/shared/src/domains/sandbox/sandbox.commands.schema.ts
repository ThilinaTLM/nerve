import { z } from "zod";
import {
  controllerConnectivityStatusSchema,
  degradedStatusSchema,
  sandboxAgentIdSchema,
  sandboxCommandIdSchema,
  sandboxConversationIdSchema,
  sandboxDaemonStatusSchema,
  sandboxInstanceIdSchema,
  sandboxRunIdSchema,
  sandboxRunStatusSchema,
  skillStatusSchema,
  startupSetupStatusSchema,
  toolGroupStatusSchema,
} from "./sandbox.common.schema.js";

export const sandboxCommandMethodSchema = z.enum([
  "sandbox.run.start",
  "sandbox.run.continue",
  "sandbox.run.cancel",
  "sandbox.input.submit",
  "sandbox.approval.resolve",
  "sandbox.status.get",
  "sandbox.snapshot.get",
]);
export type SandboxCommandMethod = z.infer<typeof sandboxCommandMethodSchema>;

export const sandboxCommandErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "UNKNOWN_CONVERSATION",
  "UNKNOWN_AGENT",
  "UNKNOWN_RUN",
  "INVALID_RUN_STATE",
  "UNKNOWN_INPUT_REQUEST",
  "UNKNOWN_APPROVAL",
  "ALREADY_RESOLVED",
  "POLICY_DENIED",
  "SANDBOX_DEGRADED",
  "SANDBOX_FAILED",
]);
export type SandboxCommandErrorCode = z.infer<
  typeof sandboxCommandErrorCodeSchema
>;

const commandScopeSchema = z.object({
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});

export const sandboxMutatingCommandBaseSchema = commandScopeSchema.extend({
  commandId: sandboxCommandIdSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SandboxMutatingCommandBase = z.infer<
  typeof sandboxMutatingCommandBaseSchema
>;

export const sandboxRunStartParamsSchema =
  sandboxMutatingCommandBaseSchema.extend({
    prompt: z.string().min(1).optional(),
    images: z
      .array(
        z.object({
          mimeType: z.string().min(1),
          dataRef: z.string().min(1),
        }),
      )
      .optional(),
    behavior: z.enum(["start", "follow_up", "steer"]).optional(),
  });
export type SandboxRunStartParams = z.infer<typeof sandboxRunStartParamsSchema>;

export const sandboxRunContinueParamsSchema =
  sandboxMutatingCommandBaseSchema.extend({
    runId: sandboxRunIdSchema,
    reason: z
      .enum(["after_input", "after_approval", "retry_error", "manual"])
      .optional(),
  });
export type SandboxRunContinueParams = z.infer<
  typeof sandboxRunContinueParamsSchema
>;

export const sandboxRunCancelParamsSchema =
  sandboxMutatingCommandBaseSchema.extend({
    runId: sandboxRunIdSchema,
    reason: z.string().min(1).optional(),
  });
export type SandboxRunCancelParams = z.infer<
  typeof sandboxRunCancelParamsSchema
>;

export const sandboxInputSubmitParamsSchema =
  sandboxMutatingCommandBaseSchema.extend({
    runId: sandboxRunIdSchema,
    requestId: z.string().min(1),
    text: z.string(),
  });
export type SandboxInputSubmitParams = z.infer<
  typeof sandboxInputSubmitParamsSchema
>;

export const sandboxApprovalResolveParamsSchema =
  sandboxMutatingCommandBaseSchema.extend({
    runId: sandboxRunIdSchema,
    approvalId: z.string().min(1),
    decision: z.enum(["grant", "deny"]),
    note: z.string().min(1).optional(),
    selectedScope: z
      .enum(["single_call", "same_tool_same_args", "run"])
      .optional(),
  });
export type SandboxApprovalResolveParams = z.infer<
  typeof sandboxApprovalResolveParamsSchema
>;

export const sandboxStatusGetParamsSchema = z.object({
  includeConversations: z.boolean().optional(),
  includeRuns: z.boolean().optional(),
  includeConfig: z.enum(["none", "digest", "sanitized"]).optional(),
  includeConnectivity: z.boolean().optional(),
});
export type SandboxStatusGetParams = z.infer<
  typeof sandboxStatusGetParamsSchema
>;

export const sandboxSnapshotGetParamsSchema = z.object({
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
  includeTranscript: z.boolean().optional(),
  includeToolCalls: z.boolean().optional(),
  includeConfig: z.enum(["none", "digest", "sanitized"]).optional(),
  includeToolGroups: z.boolean().optional(),
  includeSkills: z.boolean().optional(),
  includeSetup: z.boolean().optional(),
  includeConnectivity: z.boolean().optional(),
});
export type SandboxSnapshotGetParams = z.infer<
  typeof sandboxSnapshotGetParamsSchema
>;

export const sandboxCommandParamsByMethod = {
  "sandbox.run.start": sandboxRunStartParamsSchema,
  "sandbox.run.continue": sandboxRunContinueParamsSchema,
  "sandbox.run.cancel": sandboxRunCancelParamsSchema,
  "sandbox.input.submit": sandboxInputSubmitParamsSchema,
  "sandbox.approval.resolve": sandboxApprovalResolveParamsSchema,
  "sandbox.status.get": sandboxStatusGetParamsSchema,
  "sandbox.snapshot.get": sandboxSnapshotGetParamsSchema,
} as const;

export const sandboxCommandAcceptedResultSchema = z.object({
  accepted: z.literal(true),
  commandId: sandboxCommandIdSchema,
  status: z.enum([
    "accepted",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxCommandAcceptedResult = z.infer<
  typeof sandboxCommandAcceptedResultSchema
>;

export const sandboxRunStartResultSchema =
  sandboxCommandAcceptedResultSchema.extend({
    conversationId: sandboxConversationIdSchema,
    agentId: sandboxAgentIdSchema,
    runId: sandboxRunIdSchema,
    status: sandboxRunStatusSchema,
  });

export const sandboxRunContinueResultSchema = sandboxRunStartResultSchema;

export const sandboxRunCancelResultSchema =
  sandboxCommandAcceptedResultSchema.extend({
    conversationId: sandboxConversationIdSchema,
    agentId: sandboxAgentIdSchema,
    runId: sandboxRunIdSchema,
    status: z.enum(["queued", "running", "cancelled"]),
    cancellationRequested: z.literal(true),
  });

export const sandboxInputSubmitResultSchema =
  sandboxRunStartResultSchema.extend({
    requestId: z.string().min(1),
  });

export const sandboxApprovalResolveResultSchema =
  sandboxRunStartResultSchema.extend({
    approvalId: z.string().min(1),
    decision: z.enum(["grant", "deny"]),
  });

const sandboxConversationSummarySchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentIds: z.array(sandboxAgentIdSchema).optional(),
  title: z.string().min(1).optional(),
  updatedAt: z.string().datetime().optional(),
});

const sandboxRunSummarySchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  status: sandboxRunStatusSchema,
  updatedAt: z.string().datetime().optional(),
});

export const sandboxStatusGetResultSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  instanceId: sandboxInstanceIdSchema,
  status: sandboxDaemonStatusSchema,
  configDigest: z.string().min(1).optional(),
  startedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  degraded: degradedStatusSchema.optional(),
  connectivity: controllerConnectivityStatusSchema.optional(),
  setup: z
    .object({
      git: startupSetupStatusSchema.optional(),
      github: startupSetupStatusSchema.optional(),
      boot: startupSetupStatusSchema.optional(),
      skills: startupSetupStatusSchema.optional(),
    })
    .optional(),
  skills: z.array(skillStatusSchema).optional(),
  toolGroups: z.array(toolGroupStatusSchema).optional(),
  cursors: z
    .object({
      streams: z.array(
        z.object({
          stream: z.string().min(1),
          processedSeq: z.number().int().nonnegative().safe(),
        }),
      ),
    })
    .optional(),
  conversations: z.array(sandboxConversationSummarySchema).optional(),
  runs: z.array(sandboxRunSummarySchema).optional(),
  config: z.unknown().optional(),
});
export type SandboxStatusGetResult = z.infer<
  typeof sandboxStatusGetResultSchema
>;

const sandboxConversationSnapshotSchema =
  sandboxConversationSummarySchema.extend({
    agents: z.array(z.unknown()).optional(),
  });

const sandboxRunSnapshotSchema = sandboxRunSummarySchema.extend({
  transcript: z.array(z.unknown()).optional(),
  toolCalls: z.array(z.unknown()).optional(),
  checkpoints: z.array(z.unknown()).optional(),
});

export const sandboxSnapshotResultSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  instanceId: sandboxInstanceIdSchema,
  status: sandboxDaemonStatusSchema,
  conversations: z.array(sandboxConversationSnapshotSchema),
  runs: z.array(sandboxRunSnapshotSchema),
  configDigest: z.string().min(1).optional(),
  config: z.unknown().optional(),
  toolGroups: z.array(toolGroupStatusSchema).optional(),
  setup: z
    .object({
      git: startupSetupStatusSchema.optional(),
      github: startupSetupStatusSchema.optional(),
    })
    .optional(),
  connectivity: controllerConnectivityStatusSchema.optional(),
});
export type SandboxSnapshotResult = z.infer<typeof sandboxSnapshotResultSchema>;

export const sandboxCommandResultByMethod = {
  "sandbox.run.start": sandboxRunStartResultSchema,
  "sandbox.run.continue": sandboxRunContinueResultSchema,
  "sandbox.run.cancel": sandboxRunCancelResultSchema,
  "sandbox.input.submit": sandboxInputSubmitResultSchema,
  "sandbox.approval.resolve": sandboxApprovalResolveResultSchema,
  "sandbox.status.get": sandboxStatusGetResultSchema,
  "sandbox.snapshot.get": sandboxSnapshotResultSchema,
} as const;
