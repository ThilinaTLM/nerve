import { onEvent } from "$lib/kernel/events/event-bus";
import { selection } from "$lib/application/workspace/selection.svelte";
import {
  refreshPromptSuggestionStatuses,
  refreshPromptSuggestions,
} from "./prompt-suggestions-actions.svelte";

export function registerPromptSuggestionEventHandlers(): () => void {
  const refresh = () => {
    void refreshPromptSuggestionStatuses(selection.projectId);
    void refreshPromptSuggestions(selection.projectId, {
      conversationId: selection.conversationId,
      agentId: selection.agentId,
    });
  };
  const dispose = [
    onEvent("prompt_suggestions.trust_updated", refresh),
    onEvent("prompt_suggestions.enabled_updated", refresh),
    onEvent("prompt_suggestions.created", refresh),
  ];
  return () => {
    for (const unregister of dispose) unregister();
  };
}
