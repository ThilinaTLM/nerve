import { onEvent } from "$lib/core/events/event-bus";
import { conversationContextState } from "$lib/features/workspace/state/selection.svelte";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  refreshPromptSuggestionStatuses,
  refreshPromptSuggestions,
} from "./prompt-suggestions-actions.svelte";

export function registerPromptSuggestionEventHandlers(): () => void {
  const refresh = () => {
    const projectId = workspaceState.selectedProjectId;
    void refreshPromptSuggestionStatuses(projectId);
    void refreshPromptSuggestions(projectId, {
      conversationId: workspaceSelectors.activeConversationId,
      agentId: conversationContextState.selectedAgentId,
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
