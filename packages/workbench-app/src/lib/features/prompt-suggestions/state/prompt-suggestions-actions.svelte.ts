import { errorMessage } from "$lib/presentation/utils/error-message";
import type {
  CreatePromptSuggestionRequest,
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "../api/prompt-suggestions.api";
import {
  requestPromptSuggestionCreation,
  getPromptSuggestionStatuses,
  getPromptSuggestions,
  updatePromptSuggestionEnabled,
  updatePromptSuggestionTrust,
} from "../api/prompt-suggestions.api";
import { notify } from "$lib/application/notifications/notify.svelte";
import { promptSuggestionsState } from "./prompt-suggestions-state.svelte";

export async function refreshPromptSuggestions(
  projectId: string | undefined,
  options: { conversationId?: string } = {},
): Promise<void> {
  if (!projectId) {
    promptSuggestionsState.suggestions = [];
    promptSuggestionsState.trustRequests = [];
    promptSuggestionsState.lastProjectId = undefined;
    return;
  }
  promptSuggestionsState.loading = true;
  promptSuggestionsState.error = undefined;
  try {
    const result = await getPromptSuggestions(projectId, options);
    promptSuggestionsState.suggestions = result.suggestions;
    promptSuggestionsState.trustRequests = result.trustRequests.filter(
      (request) =>
        !promptSuggestionsState.dismissedTrustIds.includes(request.trustId),
    );
    promptSuggestionsState.statuses = result.statuses;
    promptSuggestionsState.diagnostics = result.diagnostics ?? [];
    promptSuggestionsState.lastProjectId = projectId;
  } catch (error) {
    promptSuggestionsState.error = errorMessage(error);
  } finally {
    promptSuggestionsState.loading = false;
  }
}

export async function refreshPromptSuggestionStatuses(
  projectId?: string,
): Promise<void> {
  promptSuggestionsState.loading = true;
  promptSuggestionsState.error = undefined;
  try {
    const result = await getPromptSuggestionStatuses(projectId);
    promptSuggestionsState.statuses = result.statuses;
    promptSuggestionsState.projectFile = result.projectFile;
  } catch (error) {
    promptSuggestionsState.error = errorMessage(error);
  } finally {
    promptSuggestionsState.loading = false;
  }
}

/** Applies layer writes in order, then reloads the statuses once. */
export async function setPromptSuggestionLayers(
  writes: UpdatePromptSuggestionEnabledRequest[],
  projectId?: string,
): Promise<void> {
  try {
    for (const write of writes) await updatePromptSuggestionEnabled(write);
  } finally {
    await refreshPromptSuggestionStatuses(projectId);
  }
}

export async function createPromptSuggestion(
  request: CreatePromptSuggestionRequest,
  projectId?: string,
): Promise<PromptSuggestionStatus> {
  const result = await requestPromptSuggestionCreation(request);
  await refreshPromptSuggestionStatuses(projectId);
  notify.success("Prompt suggestion created", { activity: true });
  return result.suggestion;
}

export function dismissPromptSuggestionTrustRequest(trustId: string): void {
  if (!promptSuggestionsState.dismissedTrustIds.includes(trustId)) {
    promptSuggestionsState.dismissedTrustIds = [
      ...promptSuggestionsState.dismissedTrustIds,
      trustId,
    ];
  }
  promptSuggestionsState.trustRequests =
    promptSuggestionsState.trustRequests.filter(
      (request) => request.trustId !== trustId,
    );
}

export async function setPromptSuggestionTrust(
  request: UpdatePromptSuggestionTrustRequest,
): Promise<void> {
  await updatePromptSuggestionTrust(request);
  promptSuggestionsState.dismissedTrustIds =
    promptSuggestionsState.dismissedTrustIds.filter(
      (id) => id !== request.trustId,
    );
  notify.success(
    request.status === "unset"
      ? "Prompt suggestion trust reset"
      : `Prompt suggestion ${request.status}`,
    { activity: true },
  );
}
