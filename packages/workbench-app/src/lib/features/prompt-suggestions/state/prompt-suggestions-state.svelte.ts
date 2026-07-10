import type {
  PromptSuggestion,
  PromptSuggestionDiagnostic,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
} from "$lib/api";

export const promptSuggestionsState = $state({
  suggestions: [] as PromptSuggestion[],
  trustRequests: [] as PromptSuggestionTrustRequest[],
  statuses: [] as PromptSuggestionStatus[],
  diagnostics: [] as PromptSuggestionDiagnostic[],
  loading: false,
  error: undefined as string | undefined,
  lastProjectId: undefined as string | undefined,
  dismissedTrustIds: [] as string[],
});
