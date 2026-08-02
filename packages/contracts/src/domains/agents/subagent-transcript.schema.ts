import { z } from "zod";
import { thinkingLevelSchema } from "../models/index.js";
import { conversationEntryUsageSchema } from "../conversations/tree.schema.js";
import { toolCallTranscriptRecordSchema } from "../tools/records.schema.js";
import { agentStatusSchema } from "./agent.schema.js";

export const SUBAGENT_TRANSCRIPT_MAX_ENTRIES = 500;
export const SUBAGENT_TRANSCRIPT_MAX_TOOL_CALLS = 500;
export const SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS = 65_536;
export const SUBAGENT_TRANSCRIPT_MAX_THINKING_BLOCKS = 32;

const agentIdSchema = z.string().startsWith("agent_");

const thinkingBlockSchema = z
  .object({
    text: z.string().max(SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS),
    redacted: z.boolean().optional(),
  })
  .strict();

const assistantDetailsSchema = z
  .object({
    thinkingBlocks: z
      .array(thinkingBlockSchema)
      .max(SUBAGENT_TRANSCRIPT_MAX_THINKING_BLOCKS)
      .optional(),
    stopReason: z.enum(["error", "aborted"]).optional(),
    errorMessage: z.string().max(2_048).optional(),
  })
  .strict();

const toolResultDetailsSchema = z
  .object({
    toolCallId: z.string().min(1).max(512).optional(),
    toolRecordId: z.string().startsWith("tool_").optional(),
    toolName: z.string().min(1).max(128).optional(),
    status: z.enum(["completed", "error"]),
    isError: z.boolean(),
    outputOmitted: z.boolean().optional(),
  })
  .strict();

export const subagentTranscriptEntrySchema = z
  .object({
    id: z.string().min(1).max(512),
    conversationId: z.string().startsWith("conv_"),
    agentId: agentIdSchema,
    role: z.enum(["user", "assistant", "system"]),
    kind: z.literal("message").default("message"),
    text: z.string().max(SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS),
    usage: conversationEntryUsageSchema.optional(),
    details: z
      .union([assistantDetailsSchema, toolResultDetailsSchema])
      .optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SubagentTranscriptEntry = z.infer<
  typeof subagentTranscriptEntrySchema
>;

export const subagentTranscriptSnapshotSchema = z
  .object({
    agentId: agentIdSchema,
    parentAgentId: agentIdSchema,
    status: agentStatusSchema,
    model: z.string().max(256).optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
    entries: z
      .array(subagentTranscriptEntrySchema)
      .max(SUBAGENT_TRANSCRIPT_MAX_ENTRIES),
    toolCalls: z
      .array(toolCallTranscriptRecordSchema)
      .max(SUBAGENT_TRANSCRIPT_MAX_TOOL_CALLS),
    totalEntryCount: z.number().int().nonnegative(),
    totalToolCallCount: z.number().int().nonnegative(),
    entriesTruncated: z.boolean(),
    toolCallsTruncated: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SubagentTranscriptSnapshot = z.infer<
  typeof subagentTranscriptSnapshotSchema
>;
