import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { modeSchema } from "../settings/settings.js";
import { toolCallSchema } from "./tool-call.js";
import { queuedInputSchema } from "./input.js";
import { asyncBashSchema } from "./async-bash.js";

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
  permissionRuleSetId: z.string(),
  mode: modeSchema,
  enabledTools: z.array(z.string()).nullable(),
  enabledSkills: z.array(z.string()).nullable(),
  workingDirectory: z.string(),
});
export const conversationSummarySchema = conversationSchema
  .omit({
    headEventId: true,
    statusEventSequence: true,
    nextInputSequence: true,
  })
  .extend({ childCount: z.number().int().nonnegative() });
export const conversationSnapshotSchema = z.object({
  conversation: conversationSchema,
  lastSequence: z.number().int().nonnegative(),
  config: conversationConfigSchema,
  toolCalls: z.array(toolCallSchema),
  queue: z.array(queuedInputSchema),
  asyncBash: z.array(asyncBashSchema),
  children: z.array(conversationSummarySchema),
});
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationConfig = z.infer<typeof conversationConfigSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
