import { z } from "zod";
import { modeSchema, permissionLevelSchema } from "./settings.js";

export const conversationRecordSchema = z.object({
  id: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  activeAgentId: z.string().startsWith("agent_").optional(),
  activeEntryId: z.string().startsWith("entry_").optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationRecord = z.infer<typeof conversationRecordSchema>;

export const createConversationRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

export const importConversationRequestSchema = z.object({
  project: z
    .object({
      name: z.string().min(1).optional(),
      dir: z.string().min(1),
    })
    .optional(),
  conversation: z.object({
    title: z.string().min(1).optional(),
    mode: modeSchema.optional(),
    permissionLevel: permissionLevelSchema.optional(),
  }),
  agents: z.array(z.unknown()).default([]),
  entries: z.array(z.unknown()).default([]),
});
export type ImportConversationRequest = z.infer<
  typeof importConversationRequestSchema
>;

export const conversationEntryUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});
export type ConversationEntryUsage = z.infer<
  typeof conversationEntryUsageSchema
>;

export const conversationEntryKindSchema = z.enum([
  "message",
  "compaction",
  "branch_summary",
  "subagent_summary",
  "run_status",
]);
export type ConversationEntryKind = z.infer<typeof conversationEntryKindSchema>;

export type ConversationRunStatusState = "retrying" | "retry_exhausted";

export interface ConversationRunStatusDetails {
  type: "agent_run_retry_status";
  state: ConversationRunStatusState;
  runId: string;
  failedEntryId?: string;
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  retryAt?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export const conversationEntrySchema = z.object({
  id: z.string().startsWith("entry_"),
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  parentEntryId: z.string().startsWith("entry_").optional(),
  role: z.enum(["user", "assistant", "system"]),
  kind: conversationEntryKindSchema.default("message"),
  text: z.string(),
  summary: z.string().optional(),
  tokensBefore: z.number().int().nonnegative().optional(),
  usage: conversationEntryUsageSchema.optional(),
  firstKeptEntryId: z.string().startsWith("entry_").optional(),
  fromEntryId: z.string().startsWith("entry_").optional(),
  details: z.unknown().optional(),
  createdAt: z.string().datetime(),
});
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;

export const conversationTreeNodeSchema = z.object({
  entry: conversationEntrySchema,
  childEntryIds: z.array(z.string().startsWith("entry_")),
});
export type ConversationTreeNode = z.infer<typeof conversationTreeNodeSchema>;

export const conversationTreeSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  activeEntryId: z.string().startsWith("entry_").optional(),
  rootEntryIds: z.array(z.string().startsWith("entry_")),
  nodes: z.array(conversationTreeNodeSchema),
});
export type ConversationTree = z.infer<typeof conversationTreeSchema>;

export const navigateConversationRequestSchema = z.object({
  activeEntryId: z.string().startsWith("entry_").nullable(),
  summarize: z.boolean().optional(),
  summaryInstructions: z.string().optional(),
});
export type NavigateConversationRequest = z.infer<
  typeof navigateConversationRequestSchema
>;

export const compactConversationRequestSchema = z.object({
  instructions: z.string().optional(),
  keepRecentTokens: z.number().int().positive().optional(),
});
export type CompactConversationRequest = z.infer<
  typeof compactConversationRequestSchema
>;
