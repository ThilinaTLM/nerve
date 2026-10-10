import type {
  Conversation,
  ConversationConfig,
} from "@nervekit/contracts/core";
import type {
  GitDiscoveryResponse,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { Mode } from "@nervekit/contracts/settings";
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
  buildLabel?: (input: PromptSuggestionEvaluationInput) => string;
  buildPrompt?: (input: PromptSuggestionEvaluationInput) => string;
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
  mode: Mode;
  permissionRuleSetId: string;
  reasoningLevel: ConversationConfig["reasoningLevel"];
  status: Conversation["status"];
};

export type PromptSuggestionEnableContext = {
  timestamp: string;
  platform: NodeJS.Platform;
  project: { id: string; name: string; dir: string };
  git: GitDiscoveryResponse & {
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

export function anyDirtyRepo(repos: GitRepoSummary[]): boolean {
  return repos.some((repo) => repo.dirty);
}
