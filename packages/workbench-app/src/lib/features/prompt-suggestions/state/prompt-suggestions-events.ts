import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { onConfigurationDecision } from "$lib/application/configuration-review/configuration-review-queue.svelte";
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
    });
  };
  const dispose = [
    // Decided in the review dialog, here or in another window (`configuration.decided`).
    onConfigurationDecision((review) => {
      if (review.target.kind === "prompt-suggestion") refresh();
    }),
    onEvent("prompt_suggestions.enabled_updated", refresh),
    onEvent("prompt_suggestions.created", refresh),
    onWorkbenchReconnect(refresh),
  ];
  return () => {
    for (const unregister of dispose) unregister();
  };
}
