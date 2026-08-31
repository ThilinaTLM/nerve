import { z } from "zod";
import {
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
} from "../runs/run-runtime.js";
import {
  toolCallRecordSchema,
  toolInteractionSchema,
} from "../tools/records.js";
import {
  conversationRecordSchema,
  conversationEntrySchema,
} from "./conversation-state.js";

export const CONVERSATION_JOURNAL_EPOCH = 1 as const;

const identitySchema = z.object({
  conversationId: z.string().startsWith("conv_"),
});

export const conversationInteractionRecordSchema = z.object({
  id: z.string().min(1).max(256),
  conversationId: z.string().startsWith("conv_"),
  runId: z.string().startsWith("run_"),
  executionId: z.string().startsWith("exec_"),
  suspensionId: z.string().startsWith("suspension_"),
  checkpointId: z.string().startsWith("checkpoint_"),
  toolCallId: z.string().startsWith("tool_"),
  toolCallRevision: z.number().int().positive().safe(),
  interaction: toolInteractionSchema,
});
export type ConversationInteractionRecord = z.infer<
  typeof conversationInteractionRecordSchema
>;

export const conversationSuspensionRecordSchema = z.object({
  id: z.string().startsWith("suspension_"),
  conversationId: z.string().startsWith("conv_"),
  runId: z.string().startsWith("run_"),
  executionId: z.string().startsWith("exec_"),
  checkpointId: z.string().startsWith("checkpoint_"),
  status: z.enum(["open", "resolved", "cancelled"]),
  members: z
    .array(
      z.object({
        ordinal: z.number().int().nonnegative().safe(),
        interactionId: z.string().min(1).max(256),
        toolCallId: z.string().startsWith("tool_"),
        toolCallRevision: z.number().int().positive().safe(),
        kind: z.enum(["approval", "user_input", "plan_review"]),
      }),
    )
    .min(1)
    .max(32),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationSuspensionRecord = z.infer<
  typeof conversationSuspensionRecordSchema
>;

export const modelContextJournalEntrySchema = z
  .object({
    type: z.string().min(1).max(64),
    id: z.string().startsWith("entry_"),
    parentId: z.string().startsWith("entry_").nullable(),
    timestamp: z.string().datetime(),
  })
  .catchall(z.json());

export const conversationJournalEventSchema = z.discriminatedUnion("kind", [
  identitySchema.extend({
    kind: z.literal("conversation.upserted"),
    conversation: conversationRecordSchema,
  }),
  identitySchema.extend({
    kind: z.literal("conversation.entry_appended"),
    entry: conversationEntrySchema,
  }),
  identitySchema.extend({
    kind: z.literal("model_context.entry_appended"),
    ownerAgentId: z.string().startsWith("agent_").optional(),
    entry: modelContextJournalEntrySchema,
  }),
  identitySchema.extend({
    kind: z.literal("model_context.leaf_changed"),
    ownerAgentId: z.string().startsWith("agent_").optional(),
    entryId: z.string().min(1).max(256).nullable(),
  }),
  identitySchema.extend({
    kind: z.literal("tool_call.upserted"),
    toolCall: toolCallRecordSchema,
  }),
  identitySchema.extend({
    kind: z.literal("run.transition_committed"),
    transition: runTransitionRecordSchema,
  }),
  identitySchema.extend({
    kind: z.literal("run.event_delivered"),
    delivery: runEventDeliveryRecordSchema,
  }),
  identitySchema.extend({
    kind: z.literal("interaction.upserted"),
    interaction: conversationInteractionRecordSchema,
  }),
  identitySchema.extend({
    kind: z.literal("suspension.upserted"),
    suspension: conversationSuspensionRecordSchema,
  }),
]);
export type ConversationJournalEvent = z.infer<
  typeof conversationJournalEventSchema
>;

export const conversationJournalCommitSchema = z.object({
  epoch: z.literal(CONVERSATION_JOURNAL_EPOCH),
  conversationId: z.string().startsWith("conv_"),
  commitId: z.string().startsWith("commit_"),
  idempotencyKey: z.string().min(1).max(256).optional(),
  revision: z.number().int().positive().safe(),
  previousRevision: z.number().int().nonnegative().safe(),
  previousChecksum: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  kind: z.string().min(1).max(128),
  committedAt: z.string().datetime(),
  events: z.array(conversationJournalEventSchema).min(1).max(256),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type ConversationJournalCommit = z.infer<
  typeof conversationJournalCommitSchema
>;

export type ConversationJournalCommitInput = Omit<
  ConversationJournalCommit,
  | "epoch"
  | "commitId"
  | "revision"
  | "previousRevision"
  | "previousChecksum"
  | "committedAt"
  | "checksum"
>;
