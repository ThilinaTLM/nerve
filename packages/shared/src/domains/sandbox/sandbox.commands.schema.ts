// biome-ignore lint/style/noExcessiveLinesPerFile: Sandbox command schemas intentionally centralize command names and payload contracts.
import { z } from "zod";
import { conversationSnapshotSchema } from "../conversations/index.js";
import {
  createBranchRequestSchema,
  gitBranchListResponseSchema,
  gitDiscoveryResponseSchema,
  gitFileActionRequestSchema,
  githubPrCheckoutResponseSchema,
  githubPrDetailSchema,
  githubPrListResponseSchema,
  githubStatusResponseSchema,
  gitMutationResponseSchema,
  gitOverviewResponseSchema,
  gitRemoteOpRequestSchema,
  switchBranchRequestSchema,
} from "../git/index.js";
import { thinkingLevelSchema } from "../models/index.js";
import {
  approvalPolicySchema,
  modeSchema,
  permissionLevelSchema,
} from "../settings/index.js";
import {
  startTaskRequestSchema,
  taskLogQueryResponseSchema,
  taskLogQuerySchema,
  taskRecordSchema,
} from "../tasks/index.js";
import {
  artifactRefSchema,
  boundedTextSchema,
  controllerConnectivityStatusSchema,
  degradedStatusSchema,
  isoDateTimeSchema,
  networkPolicyStatusSchema,
  redactedErrorSchema,
  sandboxAgentIdSchema,
  sandboxCommandIdSchema,
  sandboxConversationIdSchema,
  sandboxDaemonStatusSchema,
  sandboxIdSchema,
  sandboxInstanceIdSchema,
  sandboxRunIdSchema,
  sandboxRunStatusSchema,
  secretStoreStatusSchema,
  skillStatusSchema,
  startupSetupStatusSchema,
  toolGroupStatusSchema,
} from "./sandbox.common.schema.js";
import {
  managedSandboxLifecycleSummarySchema,
  sandboxRuntimeContainerStatusSchema,
} from "./sandbox.manager.schema.js";
import { sandboxToolCallRecordSchema } from "./sandbox.state.schema.js";

export const sandboxCommandMethodSchema = z.enum([
  "sandbox.run.start",
  "sandbox.run.continue",
  "sandbox.run.cancel",
  "sandbox.input.submit",
  "sandbox.approval.resolve",
  "sandbox.status.get",
  "sandbox.snapshot.get",
  "sandbox.conversation.snapshot.get",
  "sandbox.agent.configure",
  "sandbox.toolCall.get",
  "sandbox.git.repos.discover",
  "sandbox.git.overview.get",
  "sandbox.git.branches.list",
  "sandbox.git.branch.create",
  "sandbox.git.branch.switch",
  "sandbox.git.file.stage",
  "sandbox.git.file.unstage",
  "sandbox.git.file.discard",
  "sandbox.git.sync",
  "sandbox.git.push",
  "sandbox.git.pull",
  "sandbox.git.fetch",
  "sandbox.git.switchBaseAndPull",
  "sandbox.github.status.get",
  "sandbox.github.pr.list",
  "sandbox.github.pr.get",
  "sandbox.github.pr.checkout",
  "sandbox.task.list",
  "sandbox.task.start",
  "sandbox.task.get",
  "sandbox.task.cancel",
  "sandbox.task.restart",
  "sandbox.task.prune",
  "sandbox.task.delete",
  "sandbox.task.logs",
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
  "BOOTING",
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

export const sandboxRunStartParamsSchema = sandboxMutatingCommandBaseSchema
  .extend({
    prompt: z.string().min(1),
    images: z
      .array(
        z.object({
          mimeType: z.string().min(1),
          dataRef: z.string().min(1),
        }),
      )
      .optional(),
    behavior: z.enum(["start", "follow_up", "steer"]).optional(),
  })
  .superRefine((params, ctx) => {
    if (params.behavior !== "steer") return;
    for (const field of ["conversationId", "agentId", "runId"] as const) {
      if (!params[field]) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `steer requires ${field}`,
        });
      }
    }
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

export const sandboxConversationSnapshotGetParamsSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxConversationSnapshotGetParams = z.infer<
  typeof sandboxConversationSnapshotGetParamsSchema
>;

export const sandboxAgentConfigureParamsSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  model: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      thinkingLevel: thinkingLevelSchema.optional(),
    })
    .optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  approvalPolicy: approvalPolicySchema.partial().optional(),
  modelProfileId: z.string().min(1).optional(),
});
export type SandboxAgentConfigureParams = z.infer<
  typeof sandboxAgentConfigureParamsSchema
>;

export const sandboxToolCallGetParamsSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  toolCallId: z.string().min(1),
});
export type SandboxToolCallGetParams = z.infer<
  typeof sandboxToolCallGetParamsSchema
>;

const sandboxGitRepoParamsSchema = z.object({
  repo: z.string().min(1).default("."),
});
const sandboxGithubPrParamsSchema = sandboxGitRepoParamsSchema.extend({
  number: z.number().int().positive(),
});
const sandboxTaskIdParamsSchema = z.object({
  taskId: z.string().startsWith("task_"),
});
const sandboxTaskCancelParamsSchema = sandboxTaskIdParamsSchema.extend({
  signal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
  reason: z.string().min(1).optional(),
});
const sandboxTaskStartParamsSchema = startTaskRequestSchema
  .omit({ cwd: true })
  .extend({ cwd: z.string().min(1).optional() });
const sandboxTaskLogsParamsSchema =
  sandboxTaskIdParamsSchema.merge(taskLogQuerySchema);

export const sandboxCommandParamsByMethod = {
  "sandbox.run.start": sandboxRunStartParamsSchema,
  "sandbox.run.continue": sandboxRunContinueParamsSchema,
  "sandbox.run.cancel": sandboxRunCancelParamsSchema,
  "sandbox.input.submit": sandboxInputSubmitParamsSchema,
  "sandbox.approval.resolve": sandboxApprovalResolveParamsSchema,
  "sandbox.status.get": sandboxStatusGetParamsSchema,
  "sandbox.snapshot.get": sandboxSnapshotGetParamsSchema,
  "sandbox.conversation.snapshot.get":
    sandboxConversationSnapshotGetParamsSchema,
  "sandbox.agent.configure": sandboxAgentConfigureParamsSchema,
  "sandbox.toolCall.get": sandboxToolCallGetParamsSchema,
  "sandbox.git.repos.discover": z.object({}).optional(),
  "sandbox.git.overview.get": sandboxGitRepoParamsSchema,
  "sandbox.git.branches.list": sandboxGitRepoParamsSchema,
  "sandbox.git.branch.create": createBranchRequestSchema,
  "sandbox.git.branch.switch": switchBranchRequestSchema,
  "sandbox.git.file.stage": gitFileActionRequestSchema,
  "sandbox.git.file.unstage": gitFileActionRequestSchema,
  "sandbox.git.file.discard": gitFileActionRequestSchema,
  "sandbox.git.sync": gitRemoteOpRequestSchema,
  "sandbox.git.push": gitRemoteOpRequestSchema,
  "sandbox.git.pull": gitRemoteOpRequestSchema,
  "sandbox.git.fetch": gitRemoteOpRequestSchema,
  "sandbox.git.switchBaseAndPull": gitRemoteOpRequestSchema,
  "sandbox.github.status.get": sandboxGitRepoParamsSchema,
  "sandbox.github.pr.list": sandboxGitRepoParamsSchema,
  "sandbox.github.pr.get": sandboxGithubPrParamsSchema,
  "sandbox.github.pr.checkout": sandboxGithubPrParamsSchema,
  "sandbox.task.list": z.object({}).optional(),
  "sandbox.task.start": sandboxTaskStartParamsSchema,
  "sandbox.task.get": sandboxTaskIdParamsSchema,
  "sandbox.task.cancel": sandboxTaskCancelParamsSchema,
  "sandbox.task.restart": sandboxTaskIdParamsSchema,
  "sandbox.task.prune": z.object({}).optional(),
  "sandbox.task.delete": sandboxTaskIdParamsSchema,
  "sandbox.task.logs": sandboxTaskLogsParamsSchema,
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

export const sandboxModelStatusSummarySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  active: z.boolean(),
  status: z.enum(["available", "unavailable", "degraded", "skipped"]),
  limitations: z.array(z.string().min(1)).optional(),
});
export type SandboxModelStatusSummary = z.infer<
  typeof sandboxModelStatusSummarySchema
>;

export const sandboxCredentialStatusSummarySchema = z.object({
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
  updatedAt: isoDateTimeSchema.optional(),
});
export type SandboxCredentialStatusSummary = z.infer<
  typeof sandboxCredentialStatusSummarySchema
>;

export const sandboxSecretStoreStatusSummarySchema = secretStoreStatusSchema;
export type SandboxSecretStoreStatusSummary = z.infer<
  typeof sandboxSecretStoreStatusSummarySchema
>;

export const sandboxSetupStatusSummarySchema = z.object({
  git: startupSetupStatusSchema.optional(),
  github: startupSetupStatusSchema.optional(),
  boot: startupSetupStatusSchema.optional(),
  skills: startupSetupStatusSchema.optional(),
});
export type SandboxSetupStatusSummary = z.infer<
  typeof sandboxSetupStatusSummarySchema
>;

export const sandboxSetupTimelineItemSchema = z.object({
  key: z.string().min(1),
  /** Broad setup group (`config`, `git`, `github`, `boot`, `skills`, `ready`). */
  phase: z.string().min(1),
  /** Specific boot phase name when the event comes from a boot script phase. */
  name: z.string().min(1).optional(),
  index: z.number().int().nonnegative().safe().optional(),
  status: z.enum([
    "started",
    "completed",
    "failed",
    "timeout",
    "skipped",
    "degraded",
  ]),
  ts: isoDateTimeSchema,
  detail: z.string().min(1).optional(),
  runAs: z.enum(["sandbox", "root"]).optional(),
  network: z.enum(["inherit", "deny", "package_registries_only"]).optional(),
  timeoutMs: z.number().int().positive().safe().optional(),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  durationMs: z.number().int().nonnegative().safe().optional(),
  exitCode: z.number().int().safe().optional(),
  stdout: boundedTextSchema.optional(),
  stderr: boundedTextSchema.optional(),
  error: z.string().min(1).optional(),
  limitations: z.array(z.string().min(1)).optional(),
});
export type SandboxSetupTimelineItem = z.infer<
  typeof sandboxSetupTimelineItemSchema
>;

export const sandboxNetworkPolicySummarySchema = networkPolicyStatusSchema;
export type SandboxNetworkPolicySummary = z.infer<
  typeof sandboxNetworkPolicySummarySchema
>;

export const sandboxToolGroupStatusSummarySchema = toolGroupStatusSchema;
export type SandboxToolGroupStatusSummary = z.infer<
  typeof sandboxToolGroupStatusSummarySchema
>;

export const sandboxConversationSnapshotSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentIds: z.array(sandboxAgentIdSchema).optional(),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  activeRunIds: z.array(sandboxRunIdSchema).optional(),
});
export type SandboxConversationSnapshot = z.infer<
  typeof sandboxConversationSnapshotSchema
>;

export const sandboxAgentSnapshotSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  model: sandboxModelStatusSummarySchema.optional(),
  permissionLevel: z.string().min(1).optional(),
  parentAgentId: sandboxAgentIdSchema.optional(),
  childAgentIds: z.array(sandboxAgentIdSchema).optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});
export type SandboxAgentSnapshot = z.infer<typeof sandboxAgentSnapshotSchema>;

export const sandboxTranscriptSummaryEntrySchema = z.object({
  entryId: z.string().min(1),
  index: z.number().int().nonnegative().safe().optional(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  summary: z.string().min(1).optional(),
  content: boundedTextSchema.optional(),
  artifactRefs: z.array(artifactRefSchema).optional(),
  createdAt: isoDateTimeSchema.optional(),
});
export type SandboxTranscriptSummaryEntry = z.infer<
  typeof sandboxTranscriptSummaryEntrySchema
>;

export const sandboxToolCallSummarySchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  group: z.string().min(1).optional(),
  status: z.enum([
    "requested",
    "waiting_for_input",
    "waiting_for_approval",
    "started",
    "completed",
    "failed",
    "cancelled",
  ]),
  displayArgs: z.unknown().optional(),
  summary: z.string().min(1).optional(),
  artifactRefs: z.array(artifactRefSchema).optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  contentIndex: z.number().int().nonnegative().safe().optional(),
  requestedAt: isoDateTimeSchema.optional(),
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxToolCallSummary = z.infer<
  typeof sandboxToolCallSummarySchema
>;

export const sandboxWaitSummarySchema = z.object({
  waitId: z.string().min(1),
  kind: z.enum(["input", "approval"]),
  status: z.enum([
    "waiting",
    "submitted",
    "granted",
    "denied",
    "cancelled",
    "expired",
  ]),
  question: boundedTextSchema.optional(),
  toolCallId: z.string().min(1).optional(),
  approvalScope: z
    .enum(["single_call", "same_tool_same_args", "run"])
    .optional(),
  risks: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
});
export type SandboxWaitSummary = z.infer<typeof sandboxWaitSummarySchema>;

export const sandboxCheckpointSummarySchema = z.object({
  checkpointId: z.string().min(1),
  status: sandboxRunStatusSchema,
  summary: boundedTextSchema.optional(),
  stateRef: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
});
export type SandboxCheckpointSummary = z.infer<
  typeof sandboxCheckpointSummarySchema
>;

export const sandboxRunExecutionSummarySchema = z.object({
  executionId: z.string().min(1),
  attempt: z.number().int().positive().safe().optional(),
  status: z
    .enum([
      "starting",
      "streaming",
      "waiting",
      "completed",
      "failed",
      "cancelled",
      "superseded",
    ])
    .optional(),
  recoverability: z
    .enum(["checkpoint", "retryable", "manual", "none"])
    .optional(),
  lastCheckpointId: z.string().min(1).optional(),
  startedAt: isoDateTimeSchema.optional(),
  lastDeltaAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  terminalReason: z.string().min(1).optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxRunExecutionSummary = z.infer<
  typeof sandboxRunExecutionSummarySchema
>;

export const sandboxChildAgentSummarySchema = z.object({
  conversationId: sandboxConversationIdSchema.optional(),
  parentAgentId: sandboxAgentIdSchema.optional(),
  childAgentId: sandboxAgentIdSchema,
  parentRunId: sandboxRunIdSchema.optional(),
  childRunId: sandboxRunIdSchema.optional(),
  relationship: z.enum(["explore", "subagent"]),
  depth: z.number().int().nonnegative().safe().optional(),
  label: z.string().min(1).optional(),
  status: z
    .enum(["queued", "running", "completed", "failed", "cancelled"])
    .optional(),
  summary: boundedTextSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});
export type SandboxChildAgentSummary = z.infer<
  typeof sandboxChildAgentSummarySchema
>;

export const sandboxTaskSummarySchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).optional(),
  commandSummary: z.string().min(1).optional(),
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
  logCursor: z.string().min(1).optional(),
  logRef: z.string().min(1).optional(),
  logBytes: z.number().int().nonnegative().safe().optional(),
  truncated: z.boolean().optional(),
  error: redactedErrorSchema.optional(),
});
export type SandboxTaskSummary = z.infer<typeof sandboxTaskSummarySchema>;

export const sandboxRunSnapshotSchema = z.object({
  conversationId: sandboxConversationIdSchema,
  agentId: sandboxAgentIdSchema,
  runId: sandboxRunIdSchema,
  status: sandboxRunStatusSchema,
  behavior: z.enum(["start", "follow_up", "steer"]).optional(),
  promptSummary: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
  terminalAt: isoDateTimeSchema.optional(),
  error: redactedErrorSchema.optional(),
  transcriptRefs: z.array(z.string().min(1)).optional(),
  toolCallRefs: z.array(z.string().min(1)).optional(),
  checkpointRefs: z.array(z.string().min(1)).optional(),
  lastCheckpointId: z.string().min(1).optional(),
  recoverability: z
    .enum(["not_needed", "checkpoint", "retryable", "manual", "none"])
    .optional(),
  continueEligible: z.boolean().optional(),
  waits: z.array(sandboxWaitSummarySchema).optional(),
  transcript: z.array(sandboxTranscriptSummaryEntrySchema).optional(),
  toolCalls: z.array(sandboxToolCallSummarySchema).optional(),
  checkpoints: z.array(sandboxCheckpointSummarySchema).optional(),
  executions: z.array(sandboxRunExecutionSummarySchema).optional(),
  childAgents: z.array(sandboxChildAgentSummarySchema).optional(),
  tasks: z.array(sandboxTaskSummarySchema).optional(),
});
export type SandboxRunSnapshot = z.infer<typeof sandboxRunSnapshotSchema>;

export const sandboxReplayCursorSummarySchema = z.object({
  stream: z.string().min(1),
  processedSeq: z.number().int().nonnegative().safe(),
  updatedAt: isoDateTimeSchema.optional(),
});
export type SandboxReplayCursorSummary = z.infer<
  typeof sandboxReplayCursorSummarySchema
>;

export const sandboxManagerStalenessSummarySchema = z.object({
  stale: z.boolean(),
  reason: z.string().min(1).optional(),
  asOf: isoDateTimeSchema,
  lastConnectedAt: isoDateTimeSchema.optional(),
  disconnectedAt: isoDateTimeSchema.optional(),
  ageMs: z.number().int().nonnegative().safe().optional(),
});
export type SandboxManagerStalenessSummary = z.infer<
  typeof sandboxManagerStalenessSummarySchema
>;

export const sandboxControllerSessionSummarySchema = z.object({
  sessionId: z.string().min(1).optional(),
  instanceId: sandboxInstanceIdSchema.optional(),
  status: z.enum(["connected", "disconnected", "closed"]).optional(),
  connectedAt: isoDateTimeSchema.optional(),
  disconnectedAt: isoDateTimeSchema.optional(),
  readyAt: isoDateTimeSchema.optional(),
  agentStatus: z.enum(["booting", "ready", "degraded", "failed"]).optional(),
  closeCode: z.number().int().safe().optional(),
  closeReason: z.string().min(1).optional(),
  acceptedCapabilities: z.array(z.string().min(1)).optional(),
});
export type SandboxControllerSessionSummary = z.infer<
  typeof sandboxControllerSessionSummarySchema
>;

export const sandboxHardeningSummarySchema = z.object({
  encryptionAtRest: z
    .object({
      status: z.enum([
        "enabled",
        "development_cleartext",
        "unavailable",
        "unknown",
      ]),
      keyId: z.string().min(1).optional(),
      warning: z.string().min(1).optional(),
    })
    .optional(),
  lifecycle: z
    .object({
      reconcileOnStartup: z.boolean().optional(),
      reconcileIntervalMs: z.number().int().nonnegative().safe().optional(),
      gcIntervalMs: z.number().int().nonnegative().safe().optional(),
      orphanPolicy: z.string().min(1).optional(),
    })
    .optional(),
  protocol: z
    .object({
      heartbeatTimeoutMs: z.number().int().positive().safe().optional(),
      commandQueueLimit: z.number().int().nonnegative().safe().optional(),
      eventQueueLimit: z.number().int().nonnegative().safe().optional(),
    })
    .optional(),
});
export type SandboxHardeningSummary = z.infer<
  typeof sandboxHardeningSummarySchema
>;

export const sandboxStatusGetResultSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  instanceId: sandboxInstanceIdSchema,
  status: sandboxDaemonStatusSchema,
  connected: z.boolean(),
  stale: z.boolean().optional(),
  staleness: sandboxManagerStalenessSummarySchema.optional(),
  lastEventSeq: z.number().int().nonnegative().safe().optional(),
  lastEventAt: isoDateTimeSchema.optional(),
  lastSession: sandboxControllerSessionSummarySchema.optional(),
  limitations: z.array(z.string().min(1)).optional(),
  lifecycle: managedSandboxLifecycleSummarySchema.optional(),
  container: sandboxRuntimeContainerStatusSchema.optional(),
  configDigest: z.string().min(1).optional(),
  startedAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema,
  degraded: degradedStatusSchema.optional(),
  connectivity: controllerConnectivityStatusSchema.optional(),
  setup: sandboxSetupStatusSummarySchema.optional(),
  setupTimeline: z.array(sandboxSetupTimelineItemSchema).optional(),
  skills: z.array(skillStatusSchema).optional(),
  toolGroups: z.array(sandboxToolGroupStatusSummarySchema).optional(),
  models: z.array(sandboxModelStatusSummarySchema).optional(),
  secretStores: z.array(sandboxSecretStoreStatusSummarySchema).optional(),
  credentials: z.array(sandboxCredentialStatusSummarySchema).optional(),
  network: sandboxNetworkPolicySummarySchema.optional(),
  tasks: z.array(sandboxTaskSummarySchema).optional(),
  hardening: sandboxHardeningSummarySchema.optional(),

  cursors: z
    .object({
      streams: z.array(sandboxReplayCursorSummarySchema),
    })
    .optional(),
  conversations: z.array(sandboxConversationSnapshotSchema).optional(),
  agents: z.array(sandboxAgentSnapshotSchema).optional(),
  runs: z.array(sandboxRunSnapshotSchema).optional(),
  config: z.unknown().optional(),
});
export type SandboxStatusGetResult = z.infer<
  typeof sandboxStatusGetResultSchema
>;

export const sandboxSnapshotResultSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  instanceId: sandboxInstanceIdSchema,
  status: sandboxDaemonStatusSchema,
  connected: z.boolean(),
  stale: z.boolean().optional(),
  staleness: sandboxManagerStalenessSummarySchema.optional(),
  lastEventSeq: z.number().int().nonnegative().safe().optional(),
  lastEventAt: isoDateTimeSchema.optional(),
  lastSession: sandboxControllerSessionSummarySchema.optional(),
  limitations: z.array(z.string().min(1)).optional(),
  lifecycle: managedSandboxLifecycleSummarySchema.optional(),
  container: sandboxRuntimeContainerStatusSchema.optional(),
  conversations: z.array(sandboxConversationSnapshotSchema),
  agents: z.array(sandboxAgentSnapshotSchema).optional(),
  runs: z.array(sandboxRunSnapshotSchema),
  configDigest: z.string().min(1).optional(),
  config: z.unknown().optional(),
  toolGroups: z.array(sandboxToolGroupStatusSummarySchema).optional(),
  skills: z.array(skillStatusSchema).optional(),
  models: z.array(sandboxModelStatusSummarySchema).optional(),
  secretStores: z.array(sandboxSecretStoreStatusSummarySchema).optional(),
  credentials: z.array(sandboxCredentialStatusSummarySchema).optional(),
  network: sandboxNetworkPolicySummarySchema.optional(),
  replayCursors: z.array(sandboxReplayCursorSummarySchema).optional(),
  setup: sandboxSetupStatusSummarySchema.optional(),
  setupTimeline: z.array(sandboxSetupTimelineItemSchema).optional(),
  connectivity: controllerConnectivityStatusSchema.optional(),
  tasks: z.array(sandboxTaskSummarySchema).optional(),
  hardening: sandboxHardeningSummarySchema.optional(),
});
export type SandboxSnapshotResult = z.infer<typeof sandboxSnapshotResultSchema>;

export const sandboxConversationViewSnapshotSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  instanceId: sandboxInstanceIdSchema.optional(),
  status: sandboxDaemonStatusSchema.optional(),
  connected: z.boolean(),
  stale: z.boolean().optional(),
  staleness: sandboxManagerStalenessSummarySchema.optional(),
  lastEventSeq: z.number().int().nonnegative().safe().optional(),
  lastEventAt: isoDateTimeSchema.optional(),
  lastSession: sandboxControllerSessionSummarySchema.optional(),
  container: sandboxRuntimeContainerStatusSchema.optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
  snapshot: conversationSnapshotSchema.optional(),
  fallback: z
    .object({
      conversations: z.array(sandboxConversationSnapshotSchema).optional(),
      agents: z.array(sandboxAgentSnapshotSchema).optional(),
      runs: z.array(sandboxRunSnapshotSchema).optional(),
      readOnly: z.boolean().default(true),
      reason: z.string().min(1).optional(),
    })
    .optional(),
  generatedAt: isoDateTimeSchema,
});
export type SandboxConversationViewSnapshot = z.infer<
  typeof sandboxConversationViewSnapshotSchema
>;

export const sandboxAgentConfigureResultSchema = z.object({
  applied: z.object({
    conversationId: sandboxConversationIdSchema.optional(),
    agentId: sandboxAgentIdSchema.optional(),
    model: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        thinkingLevel: thinkingLevelSchema.optional(),
      })
      .optional(),
    mode: modeSchema.optional(),
    permissionLevel: permissionLevelSchema.optional(),
    approvalPolicy: approvalPolicySchema.optional(),
  }),
  warnings: z.array(z.string().min(1)).default([]),
  effectiveAt: z.enum(["next_run", "immediate"]),
});
export type SandboxAgentConfigureResult = z.infer<
  typeof sandboxAgentConfigureResultSchema
>;

export const sandboxToolCallGetResultSchema = z.object({
  toolCall: sandboxToolCallRecordSchema,
  argsPreview: z.unknown().optional(),
  resultPreview: z.unknown().optional(),
  displayTitle: z.string().min(1).optional(),
  displaySummary: z.string().min(1).optional(),
});
export type SandboxToolCallGetResult = z.infer<
  typeof sandboxToolCallGetResultSchema
>;

export const sandboxCommandResultByMethod = {
  "sandbox.run.start": sandboxRunStartResultSchema,
  "sandbox.run.continue": sandboxRunContinueResultSchema,
  "sandbox.run.cancel": sandboxRunCancelResultSchema,
  "sandbox.input.submit": sandboxInputSubmitResultSchema,
  "sandbox.approval.resolve": sandboxApprovalResolveResultSchema,
  "sandbox.status.get": sandboxStatusGetResultSchema,
  "sandbox.snapshot.get": sandboxSnapshotResultSchema,
  "sandbox.conversation.snapshot.get": sandboxConversationViewSnapshotSchema,
  "sandbox.agent.configure": sandboxAgentConfigureResultSchema,
  "sandbox.toolCall.get": sandboxToolCallGetResultSchema,
  "sandbox.git.repos.discover": gitDiscoveryResponseSchema,
  "sandbox.git.overview.get": gitOverviewResponseSchema,
  "sandbox.git.branches.list": gitBranchListResponseSchema,
  "sandbox.git.branch.create": gitMutationResponseSchema,
  "sandbox.git.branch.switch": gitMutationResponseSchema,
  "sandbox.git.file.stage": gitMutationResponseSchema,
  "sandbox.git.file.unstage": gitMutationResponseSchema,
  "sandbox.git.file.discard": gitMutationResponseSchema,
  "sandbox.git.sync": gitMutationResponseSchema,
  "sandbox.git.push": gitMutationResponseSchema,
  "sandbox.git.pull": gitMutationResponseSchema,
  "sandbox.git.fetch": gitMutationResponseSchema,
  "sandbox.git.switchBaseAndPull": gitMutationResponseSchema,
  "sandbox.github.status.get": githubStatusResponseSchema,
  "sandbox.github.pr.list": githubPrListResponseSchema,
  "sandbox.github.pr.get": githubPrDetailSchema,
  "sandbox.github.pr.checkout": githubPrCheckoutResponseSchema,
  "sandbox.task.list": z.object({ tasks: z.array(taskRecordSchema) }),
  "sandbox.task.start": z.object({ task: taskRecordSchema }),
  "sandbox.task.get": z.object({ task: taskRecordSchema }),
  "sandbox.task.cancel": z.object({ task: taskRecordSchema }),
  "sandbox.task.restart": z.object({ task: taskRecordSchema }),
  "sandbox.task.prune": z.object({
    removed: z.array(z.string().startsWith("task_")),
  }),
  "sandbox.task.delete": z.object({ removed: z.literal(true) }),
  "sandbox.task.logs": taskLogQueryResponseSchema,
} as const;
