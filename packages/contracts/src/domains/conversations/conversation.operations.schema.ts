import { contextUsageSchema } from "../models/index.js";
import {
  compactConversationRequestSchema,
  conversationEntrySchema,
  conversationRecordSchema,
  conversationTreeSchema,
  createConversationRequestSchema,
  importConversationRequestSchema,
  navigateConversationRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const okResultSchema = z.object({ ok: z.literal(true) });
const conversationIdSchema = z.string().startsWith("conv_");
const conversationIdParamsSchema = z.object({
  conversationId: conversationIdSchema,
});
const conversationNavigateParamsSchema = conversationIdParamsSchema.merge(
  navigateConversationRequestSchema,
);
const conversationCompactParamsSchema = conversationIdParamsSchema.merge(
  compactConversationRequestSchema,
);

export const conversationsOperationDefinitions = [
  defineOperation(
    "conversation.create",
    createConversationRequestSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.create",
  ),
  defineOperation(
    "conversation.import",
    importConversationRequestSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.import",
  ),
  defineOperation(
    "conversation.list",
    emptyParamsSchema,
    z.object({ conversations: z.array(conversationRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.list",
  ),
  defineOperation(
    "conversation.get",
    conversationIdParamsSchema,
    z.object({ conversation: conversationRecordSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.get",
  ),
  defineOperation(
    "conversation.delete",
    conversationIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.delete",
  ),
  defineOperation(
    "conversation.entries.list",
    conversationIdParamsSchema,
    z.object({ entries: z.array(conversationEntrySchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.entries.list",
  ),
  defineOperation(
    "conversation.contextUsage.get",
    conversationIdParamsSchema,
    z.object({ contextUsage: contextUsageSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.contextUsage.get",
  ),
  defineOperation(
    "conversation.tree.get",
    conversationIdParamsSchema,
    z.object({ tree: conversationTreeSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.tree.get",
  ),
  defineOperation(
    "conversation.navigate",
    conversationNavigateParamsSchema,
    z.object({ conversation: conversationRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.navigate",
  ),
  defineOperation(
    "conversation.compact",
    conversationCompactParamsSchema,
    z.object({
      conversation: conversationRecordSchema,
      entry: conversationEntrySchema,
    }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.conversation.compact",
  ),
] as const;
