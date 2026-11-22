import type { FileDiagnostic } from "@nervekit/contracts/configuration";
import type {
  PromptSuggestion,
  PromptSuggestionProjectFile,
  PromptSuggestionStatus,
  PromptSuggestionTrustRequest,
} from "../api/prompt-suggestions.api";

export const promptSuggestionsState = $state({
  suggestions: [] as PromptSuggestion[],
  trustRequests: [] as PromptSuggestionTrustRequest[],
  statuses: [] as PromptSuggestionStatus[],
  /** The open project's enablement file; untrusted files are ignored by the daemon. */
  projectFile: undefined as PromptSuggestionProjectFile | undefined,
  diagnostics: [] as FileDiagnostic[],
  loading: false,
  error: undefined as string | undefined,
  lastProjectId: undefined as string | undefined,
  dismissedTrustIds: [] as string[],
});
