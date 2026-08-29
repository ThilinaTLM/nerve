import { z } from "zod";
import { runRecordSchema } from "../runs/run-runtime.js";
import { toolCallRecordSchema } from "../tools/records.js";
import { conversationEntrySchema } from "../conversations/conversation-state.js";

export const conversationRecordKindSchema = z.enum([
  "message",
  "summary",
  "run",
  "tool_call",
  "tool_batch",
]);
export type ConversationRecordKind = z.infer<
  typeof conversationRecordKindSchema
>;

export const conversationRecordEnvelopeSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: z.string().startsWith("conv_"),
  agentId: z.string().startsWith("agent_").optional(),
  parentId: z.string().min(1).max(256).optional(),
  runId: z.string().startsWith("run_").optional(),
  groupId: z.string().startsWith("group_").optional(),
  sequence: z.number().int().positive().safe(),
  revision: z.number().int().positive().safe(),
  kind: conversationRecordKindSchema,
  status: z.string().min(1).max(64),
  payloadVersion: z.number().int().positive().safe(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationRecordEnvelope = z.infer<
  typeof conversationRecordEnvelopeSchema
>;

const modelContextPayloadSchema = z.object({
  visibility: z.enum([
    "model_and_history",
    "history_only",
    "model_only",
    "none",
  ]),
  /** Transport-neutral preserved harness entry used to reconstruct context. */
  entry: z.unknown().optional(),
});

export const messageRecordPayloadV1Schema = z.object({
  version: z.literal(1),
  entry: conversationEntrySchema.optional(),
  modelContext: modelContextPayloadSchema.optional(),
});
export type MessageRecordPayloadV1 = z.infer<
  typeof messageRecordPayloadV1Schema
>;

export const summaryRecordPayloadV1Schema = z.object({
  version: z.literal(1),
  entry: conversationEntrySchema.optional(),
  modelContext: modelContextPayloadSchema.optional(),
  coveredFromRecordId: z.string().min(1).optional(),
  coveredThroughRecordId: z.string().min(1).optional(),
  firstRetainedRecordId: z.string().min(1).optional(),
  tokensBefore: z.number().int().nonnegative().optional(),
  tokensAfter: z.number().int().nonnegative().optional(),
});
export type SummaryRecordPayloadV1 = z.infer<
  typeof summaryRecordPayloadV1Schema
>;

export const runRecordPayloadV1Schema = z.object({
  version: z.literal(1),
  run: runRecordSchema,
  state: z.unknown(),
});
export type RunRecordPayloadV1 = z.infer<typeof runRecordPayloadV1Schema>;

export const toolCallRecordPayloadV1Schema = z.object({
  version: z.literal(1),
  toolCall: toolCallRecordSchema,
});
export type ToolCallRecordPayloadV1 = z.infer<
  typeof toolCallRecordPayloadV1Schema
>;

export const toolCallRecordPayloadV2Schema = z.object({
  version: z.literal(2),
  toolCall: toolCallRecordSchema,
});
export type ToolCallRecordPayloadV2 = z.infer<
  typeof toolCallRecordPayloadV2Schema
>;

export const toolBatchRecordPayloadV1Schema = z.object({
  version: z.literal(1),
  toolCallIds: z.array(z.string().startsWith("tool_")).min(2).max(64),
  state: z.unknown(),
});
export type ToolBatchRecordPayloadV1 = z.infer<
  typeof toolBatchRecordPayloadV1Schema
>;

export const durableEventRecordSchema = z.object({
  sequence: z.number().int().positive().safe(),
  stream: z.string().min(1).max(256),
  conversationId: z.string().startsWith("conv_").optional(),
  recordId: z.string().min(1).max(256).optional(),
  recordRevision: z.number().int().positive().safe().optional(),
  intentId: z.string().min(1).max(512),
  eventType: z.string().min(1).max(256),
  payloadVersion: z.number().int().positive().safe(),
  data: z.unknown(),
  occurredAt: z.string().datetime(),
});
export type DurableEventRecord = z.infer<typeof durableEventRecordSchema>;
