import { definePublicEvent } from "../events/event-definition.schema.js";
import { updatePromptSuggestionTrustRequestSchema } from "./prompt-suggestion.schema.js";

const workbenchRoles = ["workbench_server"] as const;

export const promptSuggestionEventDefinitions = [
  definePublicEvent(
    "prompt_suggestions.trust_updated",
    updatePromptSuggestionTrustRequestSchema,
    { allowedSourceRoles: workbenchRoles, scope: ["trustId"] },
  ),
];
