import { onEvent } from "$lib/core/events/event-bus";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  refreshPromptSuggestionStatuses,
  refreshPromptSuggestions,
} from "./prompt-suggestions-actions.svelte";

export function registerPromptSuggestionEventHandlers(): () => void {
  return onEvent("prompt_suggestions.trust_updated", () => {
    void refreshPromptSuggestionStatuses(selection.projectId);
    void refreshPromptSuggestions(selection.projectId, {
      conversationId: selection.conversationId,
      agentId: selection.agentId,
    });
  });
}
