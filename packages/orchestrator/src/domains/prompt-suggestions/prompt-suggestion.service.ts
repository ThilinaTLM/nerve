import { join } from "node:path";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { GitService } from "../git/git-service.js";
import { evaluatePromptSuggestions } from "./prompt-suggestion-evaluator.js";
import { loadPromptSuggestionDefinitions } from "./prompt-suggestion-loader.js";
import type { PromptSuggestionTrustRepository } from "./prompt-suggestion-trust.repository.js";
import type { PromptSuggestionDefinition } from "./prompt-suggestion-types.js";

const NERVE_DIR_NAME = ".nerve";

export type PromptSuggestionServiceDeps = {
  storage: InitializedStorage;
  events: EventBus;
  trustRepository: PromptSuggestionTrustRepository;
  git: GitService;
  getProject: (projectId: string) => ProjectRecord;
  listProjects: () => ProjectRecord[];
  getConversation: (conversationId: string) => ConversationRecord;
  getAgent: (agentId: string) => AgentRecord;
};

export class PromptSuggestionService {
  constructor(private readonly deps: PromptSuggestionServiceDeps) {}

  async hydrate(): Promise<void> {
    await this.deps.trustRepository.hydrateIndex();
  }

  async listForProject(
    projectId: string,
    options: { conversationId?: string; agentId?: string } = {},
  ): Promise<PromptSuggestionListResponse> {
    const project = this.deps.getProject(projectId);
    const { definitions, diagnostics } = await this.loadDefinitions(project);
    const trustRecords = await this.deps.trustRepository.list();
    const git = await this.gitContext(projectId);
    const conversation = options.conversationId
      ? safeGet(() =>
          this.deps.getConversation(options.conversationId as string),
        )
      : undefined;
    const agent = options.agentId
      ? safeGet(() => this.deps.getAgent(options.agentId as string))
      : undefined;
    const evaluated = evaluatePromptSuggestions(
      { project, conversation, agent, git, definitions },
      trustRecords,
    );
    return {
      suggestions: evaluated.suggestions.sort(sortSuggestions),
      trustRequests: evaluated.trustRequests,
      statuses: mergeStatuses(
        evaluated.statuses,
        staleStatuses(trustRecords, definitions),
      ),
      diagnostics: [...diagnostics, ...evaluated.diagnostics],
    };
  }

  async listStatuses(projectId?: string): Promise<PromptSuggestionStatus[]> {
    const project = projectId ? this.deps.getProject(projectId) : undefined;
    const { definitions } = project
      ? await this.loadDefinitions(project)
      : await loadPromptSuggestionDefinitions([
          { kind: "user", dir: this.userSuggestionsDir() },
        ]);
    const trustRecords = await this.deps.trustRepository.list();
    const current = definitions.map((definition) => {
      const trustRecord = definition.trustId
        ? trustRecords.find((record) => record.trustId === definition.trustId)
        : undefined;
      return {
        trustId: definition.trustId,
        name: definition.name,
        label: definition.label,
        description: definition.description,
        path: definition.source.path,
        sourceKind: definition.source.kind,
        projectId: definition.source.projectId,
        requiresTrust: Boolean(definition.enableJs),
        status: definition.enableJs
          ? (trustRecord?.status ?? "unset")
          : "not_required",
        predicateHash: definition.predicateHash,
      } satisfies PromptSuggestionStatus;
    });
    return mergeStatuses(current, staleStatuses(trustRecords, definitions));
  }

  async updateTrust(
    request: UpdatePromptSuggestionTrustRequest,
  ): Promise<void> {
    if (request.status === "unset") {
      await this.deps.trustRepository.remove(request.trustId);
    } else {
      const pending = await this.findDefinitionByTrustId(request.trustId);
      if (!pending?.trustId || !pending.predicateHash) {
        throw new Error("Prompt suggestion trust target was not found.");
      }
      await this.deps.trustRepository.set({
        trustId: pending.trustId,
        sourceKind: pending.source.kind,
        path: pending.source.path,
        name: pending.name,
        label: pending.label,
        predicateHash: pending.predicateHash,
        status: request.status,
      });
    }
    await this.deps.events.publish("prompt_suggestions.trust_updated", {
      trustId: request.trustId,
      status: request.status,
    });
  }

  private async findDefinitionByTrustId(
    trustId: string,
  ): Promise<PromptSuggestionDefinition | undefined> {
    const definitions: PromptSuggestionDefinition[] = [];
    definitions.push(
      ...(
        await loadPromptSuggestionDefinitions([
          { kind: "user", dir: this.userSuggestionsDir() },
        ])
      ).definitions,
    );
    for (const project of this.deps.listProjects()) {
      definitions.push(...(await this.loadDefinitions(project)).definitions);
    }
    return definitions.find((definition) => definition.trustId === trustId);
  }

  private async loadDefinitions(project: ProjectRecord): Promise<{
    definitions: PromptSuggestionDefinition[];
    diagnostics: Awaited<
      ReturnType<typeof loadPromptSuggestionDefinitions>
    >["diagnostics"];
  }> {
    const loaded = await loadPromptSuggestionDefinitions([
      {
        kind: "project",
        dir: join(project.dir, NERVE_DIR_NAME, "suggestions"),
        projectId: project.id,
      },
      { kind: "user", dir: this.userSuggestionsDir() },
    ]);
    const byName = new Map<string, PromptSuggestionDefinition>();
    for (const definition of loaded.definitions) {
      if (!byName.has(definition.name)) byName.set(definition.name, definition);
    }
    return {
      definitions: [...byName.values()],
      diagnostics: loaded.diagnostics,
    };
  }

  private userSuggestionsDir(): string {
    return join(this.deps.storage.paths.home, "suggestions");
  }

  private async gitContext(projectId: string) {
    const discovery = await this.deps.git
      .discoverRepos(projectId)
      .catch(() => ({
        projectIsRepo: false,
        repos: [],
      }));
    const githubRepo = discovery.repos.find(
      (repo) => repo.hasRemote && repo.hasGithubRemote,
    );
    const github = githubRepo
      ? await this.deps.git
          .githubStatus(projectId, githubRepo.relativePath)
          .then((status) => ({
            available: status.available,
            authenticated: status.authenticated,
          }))
          .catch(() => undefined)
      : undefined;
    return { ...discovery, github };
  }
}

function safeGet<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch {
    return undefined;
  }
}

function sortSuggestions(
  left: PromptSuggestionListResponse["suggestions"][number],
  right: PromptSuggestionListResponse["suggestions"][number],
): number {
  return (
    left.order - right.order ||
    left.label.localeCompare(right.label) ||
    left.source.path.localeCompare(right.source.path)
  );
}

function mergeStatuses(
  current: PromptSuggestionStatus[],
  stale: PromptSuggestionStatus[],
): PromptSuggestionStatus[] {
  const byKey = new Map<string, PromptSuggestionStatus>();
  for (const status of [...current, ...stale]) {
    byKey.set(
      status.trustId ?? `${status.sourceKind}:${status.path}:${status.name}`,
      status,
    );
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.sourceKind.localeCompare(b.sourceKind) ||
      a.path.localeCompare(b.path) ||
      a.name.localeCompare(b.name),
  );
}
function staleStatuses(
  trustRecords: Awaited<ReturnType<PromptSuggestionTrustRepository["list"]>>,
  definitions: PromptSuggestionDefinition[],
): PromptSuggestionStatus[] {
  const currentTrustIds = new Set(
    definitions.map((definition) => definition.trustId).filter(Boolean),
  );
  return trustRecords
    .filter((record) => !currentTrustIds.has(record.trustId))
    .map((record) => ({
      trustId: record.trustId,
      name: record.name,
      label: record.label,
      path: record.path,
      sourceKind: record.sourceKind,
      requiresTrust: true,
      status: "stale" as const,
      predicateHash: record.predicateHash,
      stale: true,
    }));
}
