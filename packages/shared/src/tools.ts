import { z } from "zod";

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

export const coreToolNameSchema = z.enum([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "ask_user",
]);
export type CoreToolName = z.infer<typeof coreToolNameSchema>;

export const orchestrationToolNameSchema = z.enum([
  "process_start",
  "process_stop",
  "process_restart",
  "process_list",
  "process_logs",
  "subagent_run",
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

export const toolDescriptorSchema = z.object({
  name: toolNameSchema,
  risk: toolRiskSchema,
  description: z.string(),
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

export const toolCallRecordSchema = z.object({
  id: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  toolName: toolNameSchema,
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
  approvalId: z.string().startsWith("approval_").optional(),
  suspensionId: z.string().startsWith("susp_").optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

export const approvalStatusSchema = z.enum(["pending", "granted", "denied"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRecordSchema = z.object({
  id: z.string().startsWith("approval_"),
  toolCallId: z.string().startsWith("tool_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
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
  sessionId: z.string().startsWith("ses_"),
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
