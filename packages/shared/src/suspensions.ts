import { z } from "zod";

export const suspensionStatusSchema = z.enum([
  "pending",
  "resuming",
  "resumed",
  "cancelled",
  "error",
]);
export type SuspensionStatus = z.infer<typeof suspensionStatusSchema>;

export const suspendedToolNameSchema = z.enum([
  "ask_user",
  "plan_mode_present",
]);
export type SuspendedToolName = z.infer<typeof suspendedToolNameSchema>;

export const remainingToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export type RemainingToolCall = z.infer<typeof remainingToolCallSchema>;

export const agentSuspensionRecordSchema = z.object({
  id: z.string().startsWith("susp_"),
  agentId: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  runId: z.string().startsWith("run_"),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  assistantEntryId: z.string().startsWith("entry_").optional(),
  toolCallId: z.string().startsWith("tool_"),
  providerToolCallId: z.string().min(1),
  toolName: suspendedToolNameSchema,
  remainingToolCalls: z.array(remainingToolCallSchema).default([]),
  status: suspensionStatusSchema,
  reason: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type AgentSuspensionRecord = z.infer<
  typeof agentSuspensionRecordSchema
>;
