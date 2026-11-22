import {
  createPromptSuggestionRequestSchema,
  createPromptSuggestionResponseSchema,
  promptSuggestionListResponseSchema,
  promptSuggestionProjectFileSchema,
  promptSuggestionStatusSchema,
  updatePromptSuggestionEnabledRequestSchema,
  updatePromptSuggestionProjectFileTrustRequestSchema,
  updatePromptSuggestionTrustRequestSchema,
} from "./prompt-suggestion.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const okResultSchema = z.object({ ok: z.literal(true) });
const projectIdSchema = z.string().startsWith("proj_");
const conversationIdSchema = z.string().startsWith("conv_");
const promptSuggestionStatusesParamsSchema = z
  .object({ projectId: projectIdSchema.optional() })
  .optional();
const projectIdParamsSchema = z.object({ projectId: projectIdSchema });
const promptSuggestionListParamsSchema = projectIdParamsSchema.extend({
  conversationId: conversationIdSchema.optional(),
});

export const promptSuggestionsOperationDefinitions = [
  defineOperation(
    "promptSuggestion.listForProject",
    promptSuggestionListParamsSchema,
    promptSuggestionListResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.promptSuggestion.listForProject",
  ),
  defineOperation(
    "promptSuggestion.statuses.list",
    promptSuggestionStatusesParamsSchema,
    z.object({
      statuses: z.array(promptSuggestionStatusSchema),
      /** With a project: its enablement file and whether it is trusted. */
      projectFile: promptSuggestionProjectFileSchema.optional(),
    }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.promptSuggestion.statuses.list",
  ),
  defineOperation(
    "promptSuggestion.trust.update",
    updatePromptSuggestionTrustRequestSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.promptSuggestion.trust.update",
  ),
  defineOperation(
    "promptSuggestion.projectFile.trust",
    updatePromptSuggestionProjectFileTrustRequestSchema,
    z.object({ status: z.enum(["saved", "conflict"]) }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.promptSuggestion.projectFile.trust",
  ),
  defineOperation(
    "promptSuggestion.enabled.update",
    updatePromptSuggestionEnabledRequestSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.promptSuggestion.enabled.update",
  ),
  defineOperation(
    "promptSuggestion.create",
    createPromptSuggestionRequestSchema,
    createPromptSuggestionResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.promptSuggestion.create",
  ),
] as const;
