import { appliedAgentProfileSchema } from "../agent-profiles/applied-agent-profile.js";
import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { agentProfileNameSchema } from "../agent-profiles/constants.js";
import { agentProfileInstructionsSchema } from "../agent-profiles/constants.js";
import { toolCallSchema } from "./tool-call.js";
import { queuedInputSchema } from "./input.js";
import { asyncBashSchema } from "./async-bash.js";
import { compactionOperationSchema } from "./compaction-operation.js";

export const conversationStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "failed",
  "interrupted",
]);
export const conversationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentConversationId: z.string().nullable(),
  parentToolCallId: z.string().nullable(),
  headEventId: z.string().nullable(),
  title: z.string(),
  status: conversationStatusSchema,
  statusEventSequence: z.number().int().nonnegative(),
  statusClearedAt: z.string().datetime().nullable(),
  paused: z.boolean(),
  nextInputSequence: z.number().int().positive(),
  pinnedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastUserMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const conversationConfigSchema = z.object({
  conversationId: z.string(),
  model: modelSelectionSchema,
  reasoningLevel: thinkingLevelSchema,
  systemPrompt: z.string().nullable(),
  /** Extra instructions (at most 16 KB) appended to the system prompt; sub-agent profiles set it. */
  instructions: agentProfileInstructionsSchema.nullable(),
  permissionRuleSetId: z.string(),
  agentProfile: agentProfileNameSchema,

  workingDirectory: z.string(),
});
export const conversationSummarySchema = conversationSchema
  .omit({
    headEventId: true,
    statusEventSequence: true,
    nextInputSequence: true,
  })
  .extend({
    /** Latest input from the parent, including prompts still queued for delivery. */
    lastParentPromptAt: z.string().datetime().nullable().optional(),
    childCount: z.number().int().nonnegative(),
    /** Disposable cache values; unknown until configuration is lazily resolved. */
    agentProfile: agentProfileNameSchema.optional(),
    model: modelSelectionSchema.optional(),
    reasoningLevel: thinkingLevelSchema.optional(),
    permissionRuleSetId: z.string().optional(),
  });
export const conversationSnapshotSchema = z.object({
  conversation: conversationSchema,
  lastSequence: z.number().int().nonnegative(),
  config: conversationConfigSchema,
  appliedAgentProfile: appliedAgentProfileSchema.nullable(),
  toolCalls: z.array(toolCallSchema),
  queue: z.array(queuedInputSchema),
  asyncBash: z.array(asyncBashSchema),
  children: z.array(conversationSummarySchema),
  /** Runtime projection; absent after daemon restart, never a fabricated checkpoint. */
  compaction: compactionOperationSchema.nullable().optional(),
});
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationConfig = z.infer<typeof conversationConfigSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
