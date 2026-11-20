import type { FileDiagnostic } from "@nervekit/contracts/configuration";
import type {
  PromptSuggestion,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
} from "../api/prompt-suggestions.api";

export const promptSuggestionsState = $state({
  suggestions: [] as PromptSuggestion[],
  trustRequests: [] as PromptSuggestionTrustRequest[],
  statuses: [] as PromptSuggestionStatus[],
  diagnostics: [] as FileDiagnostic[],
  loading: false,
  error: undefined as string | undefined,
  lastProjectId: undefined as string | undefined,
  dismissedTrustIds: [] as string[],
});
