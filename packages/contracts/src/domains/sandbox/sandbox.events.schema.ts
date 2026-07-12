import { z } from "zod";
import {
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
} from "../events/bounded-public-data.schema.js";
import { planReviewRecordSchema } from "../plans/index.js";
import {
  artifactRefSchema,
  boundedTextSchema,
  contextFileStatusSchema,
  degradedStatusSchema,
  isoDateTimeSchema,
  networkPolicyStatusSchema,
  redactedErrorSchema,
  sandboxCredentialTypeSchema,
  sandboxDaemonStatusSchema,
  sandboxEventCommonSchema,
  sandboxRunScopeSchema,
  sandboxRunStatusSchema,
  sandboxStartupStageSchema,
  secretStoreStatusSchema,
  skillStatusSchema,
  startupSetupStatusSchema,
  toolGroupStatusSchema,
} from "./sandbox.common.schema.js";

export const sandboxStartupStageStartedEventSchema =
  sandboxEventCommonSchema.extend({
    stage: sandboxStartupStageSchema,
    attempt: z.number().int().positive().safe().default(1),
    startedAt: isoDateTimeSchema,
  });

export const sandboxStartupStageCompletedEventSchema =
  sandboxEventCommonSchema.extend({
    stage: sandboxStartupStageSchema,
    attempt: z.number().int().positive().safe().default(1),
    status: z.enum(["completed", "degraded", "skipped", "failed"]),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema,
    durationMs: z.number().int().nonnegative().safe(),
    detail: z.string().min(1).optional(),
    limitations: z.array(z.string().min(1)).optional(),
    error: redactedErrorSchema.optional(),
  });

export const sandboxConfigLoadedEventSchema = sandboxEventCommonSchema.extend({
  status: z.enum(["loaded", "degraded"]),
  configDigest: z.string().min(1),
  effectiveDefaults: boundedPublicObjectSchema.optional(),
  models: z.array(
    z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      active: z.boolean(),
      limitations: z.array(z.string().min(1)).optional(),
    }),
  ),
  toolGroups: z.array(toolGroupStatusSchema),
  secretStores: z.array(secretStoreStatusSchema).optional(),
  setup: z
    .object({
      git: startupSetupStatusSchema.optional(),
      github: startupSetupStatusSchema.optional(),
    })
    .optional(),
  network: networkPolicyStatusSchema.optional(),
  limitations: z.array(z.string().min(1)).optional(),
});

export const sandboxSecretStoreCheckedEventSchema =
  sandboxEventCommonSchema.extend({
    storeId: z.string().min(1),
    status: z.enum(["available", "unavailable", "degraded", "skipped"]),
    cacheEnabled: z.boolean().optional(),
    checkedAt: isoDateTimeSchema,
    error: redactedErrorSchema.optional(),
  });

export const sandboxCredentialsRefreshedEventSchema =
  sandboxEventCommonSchema.extend({
    provider: z.string().min(1),
    group: z.string().min(1).optional(),
    credentialType: sandboxCredentialTypeSchema.exclude(["none"]),
    status: z.enum(["refreshed", "unchanged", "failed", "skipped"]),
    expiresAt: isoDateTimeSchema.optional(),
    persisted: z.enum(["state", "file", "none", "not_applicable"]),
    error: redactedErrorSchema.optional(),
  });

export const sandboxSetupStartedEventSchema = sandboxEventCommonSchema.extend({
  setup: z.enum(["git", "github"]),
  startedAt: isoDateTimeSchema,
});

export const sandboxSetupCompletedEventSchema = sandboxEventCommonSchema.extend(
  {
    setup: z.enum(["git", "github"]),
    status: z.enum(["completed", "failed", "degraded", "skipped"]),
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema,
    summary: boundedPublicObjectSchema.optional(),
    limitations: z.array(z.string().min(1)).optional(),
    error: redactedErrorSchema.optional(),
  },
);

export const sandboxBootStartedEventSchema = sandboxEventCommonSchema.extend({
  phase: z.string().min(1),
  index: z.number().int().nonnegative().safe(),
  startedAt: isoDateTimeSchema,
  timeoutMs: z.number().int().positive().safe(),
  runAs: z.enum(["sandbox", "root"]),
  network: z.enum(["inherit", "deny", "package_registries_only"]),
});

export const sandboxBootCompletedEventSchema = sandboxEventCommonSchema.extend({
  phase: z.string().min(1),
  index: z.number().int().nonnegative().safe(),
  status: z.enum(["completed", "failed", "timeout", "skipped"]),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema,
  exitCode: z.number().int().safe().optional(),
  stdout: boundedTextSchema.optional(),
  stderr: boundedTextSchema.optional(),
  artifacts: z.array(artifactRefSchema).optional(),
  lockfileDigests: z
    .array(
      z.object({
        path: z.string().min(1),
        before: z.string().min(1).optional(),
        after: z.string().min(1).optional(),
      }),
    )
    .optional(),
  error: redactedErrorSchema.optional(),
});

export const sandboxSkillsLoadedEventSchema = sandboxEventCommonSchema.extend({
  status: z.enum(["loaded", "degraded", "failed"]),
  contextFiles: z.array(contextFileStatusSchema),
  skills: z.array(skillStatusSchema),
  diagnostics: z
    .array(
      z.object({
        level: z.enum(["info", "warn", "error"]),
        message: z.string().min(1),
        path: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

export const sandboxReadyEventSchema = sandboxEventCommonSchema.extend({
  status: z.enum(["ready", "degraded"]),
  readyAt: isoDateTimeSchema,
  recovered: z.boolean(),
  daemonStatus: sandboxDaemonStatusSchema,
  degraded: degradedStatusSchema.optional(),
  cursor: z.object({
    streams: z.array(
      z.object({
        stream: z.string().min(1),
        processedSeq: z.number().int().nonnegative().safe(),
      }),
    ),
  }),
});

export const sandboxControllerDisconnectedEventSchema =
  sandboxEventCommonSchema.extend({
    disconnectedAt: isoDateTimeSchema,
    reason: z.enum([
      "transport_closed",
      "heartbeat_timeout",
      "auth_failed",
      "protocol_error",
      "network_error",
      "unknown",
    ]),
    retryable: z.boolean(),
    reconnectAttempts: z.number().int().nonnegative().safe().optional(),
    closeCode: z.number().int().safe().optional(),
    closeReason: z.string().min(1).optional(),
    exitAfterMs: z.number().int().nonnegative().safe().optional(),
    exitAt: isoDateTimeSchema.optional(),
  });

export const sandboxControllerReconnectedEventSchema =
  sandboxEventCommonSchema.extend({
    disconnectedAt: isoDateTimeSchema.optional(),
    reconnectedAt: isoDateTimeSchema,
    downtimeMs: z.number().int().nonnegative().safe().optional(),
    reconnectAttempts: z.number().int().nonnegative().safe().optional(),
    sessionId: z.string().min(1),
    replayRequired: z.boolean().optional(),
  });

export const sandboxShutdownEventSchema = sandboxEventCommonSchema.extend({
  reason: z.enum([
    "controller_disconnect_timeout",
    "manager_request",
    "resource_limit",
    "fatal_error",
  ]),
  scheduledAt: isoDateTimeSchema.optional(),
  startedAt: isoDateTimeSchema.optional(),
  exitAt: isoDateTimeSchema.optional(),
  graceMs: z.number().int().nonnegative().safe().optional(),
  exitCode: z.number().int().safe().optional(),
});

export const sandboxSecurityDeniedEventSchema = sandboxEventCommonSchema.extend(
  {
    scope: z.string().min(1),
    reason: z.string().min(1),
    resource: z.string().min(1).optional(),
    deniedAt: isoDateTimeSchema,
  },
);

export const runStartedEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    requestId: z.string().min(1),
    status: z.enum(["queued", "running"]),
    promptSummary: z.string().min(1).optional(),
    mode: z.enum(["coding", "planning"]).optional(),
    model: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      thinkingLevel: z.string().min(1).optional(),
    }),
    startedAt: isoDateTimeSchema,
  });

export const runDeltaEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    deltaId: z.string().min(1),
    role: z.enum(["assistant", "tool", "system"]),
    text: z.string().optional(),
    artifactRefs: z.array(artifactRefSchema).optional(),
    finishReason: z.string().min(1).optional(),
  });

export const runTranscriptAppendedEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    entryId: z.string().min(1),
    index: z.number().int().nonnegative().safe(),
    role: z.enum(["user", "assistant", "tool", "system"]),
    content: z.union([boundedTextSchema, artifactRefSchema]),
    details: boundedPublicJsonSchema.optional(),
    createdAt: isoDateTimeSchema,
  });

export const runWaitingForInputEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    waitKind: z.literal("input"),
    requestId: z.string().min(1),
    question: boundedTextSchema,
    placeholder: z.string().optional(),
    required: z.boolean(),
    createdAt: isoDateTimeSchema,
  });

export const runWaitingForApprovalEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    waitKind: z.literal("approval"),
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    risk: z.array(z.string().min(1)),
    reason: z.string().min(1),
    normalizedArgs: boundedPublicJsonSchema,
    offeredScopes: z
      .array(z.enum(["single_call", "same_tool_same_args", "run"]))
      .optional(),
    createdAt: isoDateTimeSchema.optional(),
  });

export const runWaitingForPlanReviewEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    waitKind: z.literal("plan_review"),
    reviewId: z.string().startsWith("plan_review_"),
    toolCallId: z.string().min(1),
    planReview: planReviewRecordSchema,
    createdAt: isoDateTimeSchema,
  });

export const runCheckpointedEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    checkpointId: z.string().min(1),
    status: sandboxRunStatusSchema,
    checkpointedAt: isoDateTimeSchema,
  });

export const runTerminalEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    status: z.enum(["completed", "cancelled"]),
    completedAt: isoDateTimeSchema.optional(),
    cancelledAt: isoDateTimeSchema.optional(),
  });

export const runFailedEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    status: z.literal("failed"),
    failedAt: isoDateTimeSchema,
    error: redactedErrorSchema,
  });

export const toolCallEventSchema = sandboxEventCommonSchema
  .merge(sandboxRunScopeSchema)
  .extend({
    toolCallId: z.string().min(1),
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
    args: boundedPublicJsonSchema.optional(),
    displayArgs: boundedPublicJsonSchema.optional(),
    approvalId: z.string().min(1).optional(),
    artifactRefs: z.array(artifactRefSchema).optional(),
    lifecycleSeq: z.number().int().nonnegative().safe().optional(),
    result: boundedPublicJsonSchema.optional(),
    error: redactedErrorSchema.optional(),
    requestedAt: isoDateTimeSchema.optional(),
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema.optional(),
    cancelledAt: isoDateTimeSchema.optional(),
  });

export const sandboxOperationalEventPayloadSchemas = {
  "sandbox.startup.stage.started": sandboxStartupStageStartedEventSchema,
  "sandbox.startup.stage.completed": sandboxStartupStageCompletedEventSchema,
  "sandbox.config.loaded": sandboxConfigLoadedEventSchema,
  "sandbox.secret_store.checked": sandboxSecretStoreCheckedEventSchema,
  "sandbox.credentials.refreshed": sandboxCredentialsRefreshedEventSchema,
  "sandbox.setup.git.started": sandboxSetupStartedEventSchema,
  "sandbox.setup.git.completed": sandboxSetupCompletedEventSchema,
  "sandbox.setup.github.started": sandboxSetupStartedEventSchema,
  "sandbox.setup.github.completed": sandboxSetupCompletedEventSchema,
  "sandbox.boot.started": sandboxBootStartedEventSchema,
  "sandbox.boot.completed": sandboxBootCompletedEventSchema,
  "sandbox.skills.loaded": sandboxSkillsLoadedEventSchema,
  "sandbox.ready": sandboxReadyEventSchema,
  "sandbox.controller.disconnected": sandboxControllerDisconnectedEventSchema,
  "sandbox.controller.reconnected": sandboxControllerReconnectedEventSchema,
  "sandbox.shutdown.scheduled": sandboxShutdownEventSchema,
  "sandbox.shutdown.started": sandboxShutdownEventSchema,
  "sandbox.security.denied": sandboxSecurityDeniedEventSchema,
  "run.delta": runDeltaEventSchema,
  "run.transcript.appended": runTranscriptAppendedEventSchema,
  "run.waiting": z.union([
    runWaitingForInputEventSchema,
    runWaitingForApprovalEventSchema,
    runWaitingForPlanReviewEventSchema,
  ]),
  "run.checkpointed": runCheckpointedEventSchema,
  "run.cancelled": runTerminalEventSchema,
} as const;

const sandboxEventNames = Object.keys(
  sandboxOperationalEventPayloadSchemas,
) as [
  keyof typeof sandboxOperationalEventPayloadSchemas,
  ...(keyof typeof sandboxOperationalEventPayloadSchemas)[],
];
export const sandboxEventTypeSchema = z.enum(sandboxEventNames);
export type SandboxEventType = z.infer<typeof sandboxEventTypeSchema>;

export const sandboxEventEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().positive().safe(),
    type: z.string().min(1),
    ts: isoDateTimeSchema,
    durability: z.enum(["durable", "transient"]).default("durable"),
    data: boundedPublicJsonSchema,
  })
  .superRefine((event, context) => {
    const schema =
      sandboxOperationalEventPayloadSchemas[
        event.type as keyof typeof sandboxOperationalEventPayloadSchemas
      ];
    const parsed = schema?.safeParse(event.data);
    if (!parsed?.success) {
      context.addIssue({
        code: "custom",
        path: ["data"],
        message: `invalid payload for ${event.type}`,
      });
    }
  });
export type SandboxEventEnvelope = z.infer<typeof sandboxEventEnvelopeSchema>;
