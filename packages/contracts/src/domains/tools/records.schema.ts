import { z } from "zod";
import {
  boundedPublicJsonSchema,
  boundedPublicObjectSchema,
} from "../events/bounded-public-data.schema.js";

const toolCallTranscriptPreviewSchema = boundedPublicJsonSchema.transform(
  (value): unknown => value,
);
const toolCallTranscriptErrorDetailsSchema =
  boundedPublicObjectSchema.transform(
    (value): Record<string, unknown> => value,
  );

export const toolRiskSchema = z.enum([
  "read",
  "workspace_write",
  "command",
  "network",
  "secret",
  "destructive",
  "agent_spawn",
  "deployment",
  "interaction",
]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

export const toolGroupNameSchema = z.enum([
  "fileInspection",
  "fileEditing",
  "shell",
  "python",
  "web",
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

export const coreToolNameSchema = z.enum([
  "read",
  "bash",
  "python",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "ask_user",
  "todos_set",
  "todos_get",
  "web_search",
  "web_fetch",
  "jira_search_users",
  "jira_search_issues",
  "jira_get_issue",
  "jira_get_project",
  "jira_create_issue",
  "jira_update_issue",
  "jira_add_comment",
  "jira_transition_issue",
  "confluence_search_spaces",
  "confluence_search_pages",
  "confluence_get_page",
  "confluence_download_pages",
  "confluence_create_page",
  "confluence_update_page",
  "confluence_publish_pages",
  "confluence_upload_attachment",
]);
export type CoreToolName = z.infer<typeof coreToolNameSchema>;

export const userConfigurableToolNameSchema = z.enum([
  "web_search",
  "web_fetch",
  "python",
]);
export type UserConfigurableToolName = z.infer<
  typeof userConfigurableToolNameSchema
>;

export const orchestrationToolNameSchema = z.enum([
  "task_start",
  "task_status",
  "task_logs",
  "task_cancel",
  "task_restart",
  "explore",
  "plan_mode_enter",
  "plan_mode_present",
  "plan_mode_force_exit",
]);
export type OrchestrationToolName = z.infer<typeof orchestrationToolNameSchema>;

export const toolNameSchema = z.enum([
  ...coreToolNameSchema.options,
  ...orchestrationToolNameSchema.options,
]);
export type ToolName = z.infer<typeof toolNameSchema>;

// Tool-call records outlive the manifest that produced them. Keep persisted and
// transcript records readable after tools are renamed or removed while the
// active descriptor/dispatch schemas remain restricted to ToolName.
export const recordedToolNameSchema = z.string().min(1).max(128);
export type RecordedToolName = z.infer<typeof recordedToolNameSchema>;

export const toolDescriptorSchema = z.object({
  name: toolNameSchema,
  risk: toolRiskSchema,
  description: z.string(),
  group: toolGroupNameSchema,
  executionKind: toolExecutionKindSchema,
  traits: z.array(toolTraitSchema),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const toolCallStatusSchema = z.enum([
  "requested",
  "pending_approval",
  "waiting_for_user",
  "running",
  "completed",
  "denied",
  "error",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolCallErrorDetailsSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolCallErrorDetails = z.infer<typeof toolCallErrorDetailsSchema>;

export const toolCallRecordSchema = z.object({
  id: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  toolName: recordedToolNameSchema,
  sourceToolCallId: z.string().min(1).optional(),
  providerToolCallId: z.string().min(1).optional(),
  runId: z.string().startsWith("run_").optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  contentIndex: z.number().int().nonnegative().optional(),
  risk: toolRiskSchema,
  args: z.unknown(),
  cwd: z.string().min(1),
  status: toolCallStatusSchema,
  hidden: z.boolean().optional(),
  approvalId: z.string().startsWith("approval_").optional(),
  suspensionId: z.string().startsWith("susp_").optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  errorDetails: toolCallErrorDetailsSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

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
export const toolCallTranscriptRecordSchema = toolCallRecordSchema
  .omit({ args: true, result: true, error: true, errorDetails: true })
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
  placeholder: z.string().optional(),
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
