import type {
  Conversation,
  ConversationConfig,
} from "@nervekit/contracts/core";
import type {
  GitDiscoveryResponse,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type {
  PromptSuggestionSourceKind,
  PromptSuggestionWhen,
} from "@nervekit/contracts/prompt-suggestions";

export type PromptSuggestionDiagnosticCode =
  | "list_failed"
  | "read_failed"
  | "parse_failed"
  | "invalid_metadata"
  | "enable_failed";

export type PromptSuggestionDiagnostic = {
  type: "warning";
  code: PromptSuggestionDiagnosticCode;
  message: string;
  path: string;
};

export type PromptSuggestionDefinition = {
  id: string;
  definitionKey: string;
  name: string;
  label: string;
  description?: string;
  prompt: string;
  /** Static "Appears when…" text; derived from `when` when absent. */
  conditionSummary?: string;
  /** Sample rendering shown in Settings; defaults to the prompt body. */
  promptPreview?: string;
  buildLabel?: (input: PromptSuggestionEvaluationInput) => string;
  buildPrompt?: (input: PromptSuggestionEvaluationInput) => string;
  /** One-line summary of the state that triggered the suggestion. */
  buildContext?: (input: PromptSuggestionEvaluationInput) => string | undefined;
  order: number;
  defaultEnabled: boolean;
  enabled: boolean;
  when?: PromptSuggestionWhen;
  matches?: (input: PromptSuggestionEvaluationInput) => boolean;
  enableJs?: string;
  predicateHash?: string;
  trustId?: string;
  source: {
    kind: PromptSuggestionSourceKind;
    path: string;
    projectId?: string;
  };
};

export type PromptSuggestionConversationContext = {
  id: string;
  title: string;
  permissionRuleSetId: string;
  reasoningLevel: ConversationConfig["reasoningLevel"];
  status: Conversation["status"];
};

/** Open pull request for a repo's current branch, from the PR sync cache. */
export type PromptSuggestionPullRequest = {
  number: number;
  url: string;
  isDraft: boolean;
  /** Outcome so far; a failure outranks checks still running. */
  checks: "pending" | "passing" | "failing" | "none";
  /** Whether any check is still running or queued, whatever `checks` says. */
  checksRunning: boolean;
  reviewRequested: boolean;
};

export type PromptSuggestionRepo = GitRepoSummary & {
  /** `undefined` = unknown (not GitHub / unavailable); `null` = no open PR. */
  pullRequest?: PromptSuggestionPullRequest | null;
};

export type PromptSuggestionEnableContext = {
  timestamp: string;
  platform: NodeJS.Platform;
  project: { id: string; name: string; dir: string };
  git: Omit<GitDiscoveryResponse, "repos"> & {
    repos: PromptSuggestionRepo[];
    github?: Pick<GithubStatusResponse, "available" | "authenticated">;
  };
  conversation?: PromptSuggestionConversationContext;
};

export type PromptSuggestionEvaluationInput = {
  project: PromptSuggestionEnableContext["project"];
  conversation?: PromptSuggestionConversationContext;
  git: PromptSuggestionEnableContext["git"];
  definitions: PromptSuggestionDefinition[];
};

export function anyDirtyRepo(repos: PromptSuggestionRepo[]): boolean {
  return repos.some((repo) => repo.dirty);
}
