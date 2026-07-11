import {
  promptSuggestionListResponseSchema,
  promptSuggestionStatusSchema,
  updatePromptSuggestionTrustRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const projectIdSchema = z.string().startsWith("proj_");
const conversationIdSchema = z.string().startsWith("conv_");
const agentIdSchema = z.string().startsWith("agent_");
const promptSuggestionStatusesParamsSchema = z
  .object({ projectId: projectIdSchema.optional() })
  .optional();
const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const promptSuggestionListParamsSchema = projectIdParamsSchema.extend({
  conversationId: conversationIdSchema.optional(),
  agentId: agentIdSchema.optional(),
});

export const promptSuggestionsOperationDefinitions = [
  defineOperation(
    "promptSuggestion.listForProject",
    promptSuggestionListParamsSchema,
    promptSuggestionListResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.promptSuggestion.listForProject",
  ),
  defineOperation(
    "promptSuggestion.statuses.list",
    promptSuggestionStatusesParamsSchema,
    z.object({ statuses: z.array(promptSuggestionStatusSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.promptSuggestion.statuses.list",
  ),
  defineOperation(
    "promptSuggestion.trust.update",
    updatePromptSuggestionTrustRequestSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.promptSuggestion.trust.update",
  ),
] as const;
