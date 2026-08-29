import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import {
  promptSuggestionSourceKindSchema,
  updatePromptSuggestionEnabledRequestSchema,
  updatePromptSuggestionTrustRequestSchema,
} from "./prompt-suggestion.js";

const workbenchRoles = ["workbench_server"] as const;

export const promptSuggestionCreatedEventSchema = z.object({
  definitionKey: z.string().min(1),
  name: z.string().min(1),
  sourceKind: promptSuggestionSourceKindSchema,
  projectId: z.string().startsWith("proj_").optional(),
});

export const promptSuggestionEventDefinitions = [
  definePublicEvent(
    "prompt_suggestions.trust_updated",
    updatePromptSuggestionTrustRequestSchema,
    { allowedSourceRoles: workbenchRoles, scope: ["trustId"] },
  ),
  definePublicEvent(
    "prompt_suggestions.enabled_updated",
    updatePromptSuggestionEnabledRequestSchema,
    { allowedSourceRoles: workbenchRoles, scope: ["definitionKey"] },
  ),
  definePublicEvent(
    "prompt_suggestions.created",
    promptSuggestionCreatedEventSchema,
    { allowedSourceRoles: workbenchRoles, scope: ["definitionKey"] },
  ),
];
