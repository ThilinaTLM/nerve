import type {
  AgentRecord,
  ConversationRecord,
  GitDiscoveryResponse,
  GithubStatusResponse,
  GitRepoSummary,
  Mode,
  PermissionLevel,
  ProjectRecord,
  PromptSuggestionSourceKind,
  PromptSuggestionWhen,
} from "@nervekit/shared";

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
  name: string;
  label: string;
  description?: string;
  prompt: string;
  order: number;
  enabled: boolean;
  when?: PromptSuggestionWhen;
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
