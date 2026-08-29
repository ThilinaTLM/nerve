import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type {
  GitDiscoveryResponse,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { Mode } from "@nervekit/contracts/settings";
import type { PermissionLevel } from "@nervekit/contracts/permissions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
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

export type PromptSuggestionEnableContext = {
  now: string;
  platform: NodeJS.Platform;
  project: Pick<ProjectRecord, "id" | "name" | "dir">;
  git: GitDiscoveryResponse & {
    github?: Pick<GithubStatusResponse, "available" | "authenticated">;
  };
  conversation?: Pick<
    ConversationRecord,
    "id" | "title" | "mode" | "permissionLevel"
  >;
  agent?: Pick<
    AgentRecord,
    "id" | "mode" | "permissionLevel" | "status" | "thinkingLevel"
  >;
};

export type PromptSuggestionEvaluationInput = {
  project: ProjectRecord;
  conversation?: ConversationRecord;
  agent?: AgentRecord;
  git: GitDiscoveryResponse & {
    github?: Pick<GithubStatusResponse, "available" | "authenticated">;
  };
  definitions: PromptSuggestionDefinition[];
};

export function activeMode(input: {
  agent?: AgentRecord;
  conversation?: ConversationRecord;
}): Mode | undefined {
  return input.agent?.mode ?? input.conversation?.mode;
}

export function activePermissionLevel(input: {
  agent?: AgentRecord;
  conversation?: ConversationRecord;
}): PermissionLevel | undefined {
  return input.agent?.permissionLevel ?? input.conversation?.permissionLevel;
}

export function anyDirtyRepo(repos: GitRepoSummary[]): boolean {
  return repos.some((repo) => repo.dirty);
}
