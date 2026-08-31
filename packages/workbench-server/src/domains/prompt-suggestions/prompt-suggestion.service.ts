import { mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { GitService } from "@nervekit/tools/git";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type {
  CreatePromptSuggestionRequest,
  PromptSuggestionListResponse,
  PromptSuggestionStatus,
  UpdatePromptSuggestionEnabledRequest,
  UpdatePromptSuggestionTrustRequest,
} from "@nervekit/contracts/prompt-suggestions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/index.js";
import { builtinPromptSuggestionDefinitions } from "./prompt-suggestion-builtins.js";
import type { PromptSuggestionEnablementRepository } from "./prompt-suggestion-enablement.repository.js";
import { evaluatePromptSuggestions } from "./prompt-suggestion-evaluator.js";
import {
  loadPromptSuggestionDefinitions,
  serializePromptSuggestionMarkdown,
} from "./prompt-suggestion-loader.js";
import type { PromptSuggestionTrustRepository } from "./prompt-suggestion-trust.repository.js";
import type { PromptSuggestionDefinition } from "./prompt-suggestion-types.js";

const NERVE_DIR_NAME = ".nerve";

export type PromptSuggestionServiceDeps = {
  storage: InitializedStorage;
  events: StreamLogRegistry;
  trustRepository: PromptSuggestionTrustRepository;
  enablementRepository: PromptSuggestionEnablementRepository;
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
    const loaded = await this.discoverDefinitions(project);
    const definitions = await this.applyEnablement(loaded.definitions);
    const effective = effectiveDefinitions(definitions);
    const trustRecords = await this.deps.trustRepository.list();
    const git = await this.gitContext(projectId);
    const conversation = options.conversationId
      ? safeGet(() => this.deps.getConversation(options.conversationId!))
      : undefined;
    const agent = options.agentId
      ? safeGet(() => this.deps.getAgent(options.agentId!))
      : undefined;
    const evaluated = evaluatePromptSuggestions(
      { project, conversation, agent, git, definitions: effective },
      trustRecords,
    );
    return {
      suggestions: evaluated.suggestions.sort(sortSuggestions),
      trustRequests: evaluated.trustRequests,
      statuses: mergeStatuses(
        statusesFor(definitions, trustRecords),
        staleStatuses(trustRecords, definitions),
      ),
      diagnostics: [...loaded.diagnostics, ...evaluated.diagnostics],
    };
  }

  async listStatuses(projectId?: string): Promise<PromptSuggestionStatus[]> {
    const project = projectId ? this.deps.getProject(projectId) : undefined;
    const loaded = await this.discoverDefinitions(project);
    const definitions = await this.applyEnablement(loaded.definitions);
    const trustRecords = await this.deps.trustRepository.list();
    return mergeStatuses(
      statusesFor(definitions, trustRecords),
      staleStatuses(trustRecords, definitions),
    );
  }

  async updateEnabled(
    request: UpdatePromptSuggestionEnabledRequest,
  ): Promise<void> {
    const definition = await this.findDefinitionByKey(request.definitionKey);
    if (!definition) throw new Error("Prompt suggestion was not found.");
    await this.deps.enablementRepository.set(
      request.definitionKey,
      request.enabled,
    );
    await this.deps.events.publish(
      "prompt_suggestions.enabled_updated",
      request,
    );
  }

  async create(
    request: CreatePromptSuggestionRequest,
  ): Promise<PromptSuggestionStatus> {
    const project =
      request.scope === "project"
        ? this.deps.getProject(request.projectId!)
        : undefined;
    const dir = project
      ? join(project.dir, NERVE_DIR_NAME, "suggestions")
      : this.userSuggestionsDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (project) await assertDirectoryInsideProject(project.dir, dir);

    const path = join(dir, `${request.name}.md`);
    const file = await open(path, "wx", 0o600).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
          throw new Error(
            `A prompt suggestion named "${request.name}" already exists in this scope.`,
          );
        }
        throw error;
      },
    );
    try {
      await file.writeFile(serializePromptSuggestionMarkdown(request), "utf8");
    } finally {
      await file.close();
    }

    const loaded = await loadPromptSuggestionDefinitions([
      {
        kind: request.scope,
        dir,
        ...(project ? { projectId: project.id } : {}),
      },
    ]);
    const definition = loaded.definitions.find(
      (candidate) => candidate.name === request.name,
    );
    if (!definition) {
      throw new Error(
        "The prompt suggestion file was created but could not be loaded.",
      );
    }
    const [status] = statusesFor([definition], []);
    await this.deps.events.publish("prompt_suggestions.created", {
      definitionKey: definition.definitionKey,
      name: definition.name,
      sourceKind: definition.source.kind,
      projectId: definition.source.projectId,
    });
    return status;
  }

  async updateTrust(
    request: UpdatePromptSuggestionTrustRequest,
  ): Promise<void> {
    if (request.status === "unset") {
      await this.deps.trustRepository.remove(request.trustId);
    } else {
      const pending = await this.findDefinitionByTrustId(request.trustId);
      if (
        !pending?.trustId ||
        !pending.predicateHash ||
        pending.source.kind === "builtin"
      ) {
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

  private async findDefinitionByKey(
    definitionKey: string,
  ): Promise<PromptSuggestionDefinition | undefined> {
    const base = await this.discoverDefinitions();
    const definitions = [...base.definitions];
    for (const project of this.deps.listProjects()) {
      definitions.push(...(await this.discoverProjectDefinitions(project)));
    }
    return definitions.find(
      (definition) => definition.definitionKey === definitionKey,
    );
  }

  private async findDefinitionByTrustId(
    trustId: string,
  ): Promise<PromptSuggestionDefinition | undefined> {
    const base = await this.discoverDefinitions();
    const definitions = [...base.definitions];
    for (const project of this.deps.listProjects()) {
      definitions.push(...(await this.discoverProjectDefinitions(project)));
    }
    return definitions.find((definition) => definition.trustId === trustId);
  }

  private async discoverDefinitions(project?: ProjectRecord) {
    const inputs = [
      ...(project
        ? [
            {
              kind: "project" as const,
              dir: join(project.dir, NERVE_DIR_NAME, "suggestions"),
              projectId: project.id,
            },
          ]
        : []),
      { kind: "user" as const, dir: this.userSuggestionsDir() },
    ];
    const loaded = await loadPromptSuggestionDefinitions(inputs);
    return {
      definitions: [
        ...loaded.definitions,
        ...builtinPromptSuggestionDefinitions(),
      ],
      diagnostics: loaded.diagnostics,
    };
  }

  private async discoverProjectDefinitions(project: ProjectRecord) {
    return (
      await loadPromptSuggestionDefinitions([
        {
          kind: "project",
          dir: join(project.dir, NERVE_DIR_NAME, "suggestions"),
          projectId: project.id,
        },
      ])
    ).definitions;
  }

  private async applyEnablement(
    definitions: PromptSuggestionDefinition[],
  ): Promise<PromptSuggestionDefinition[]> {
    const overrides = new Map(
      (await this.deps.enablementRepository.list()).map((record) => [
        record.definitionKey,
        record.enabled,
      ]),
    );
    return definitions.map((definition) => ({
      ...definition,
      enabled:
        overrides.get(definition.definitionKey) ?? definition.defaultEnabled,
    }));
  }

  private userSuggestionsDir(): string {
    return (
      this.deps.storage.paths.suggestionsPath ??
      storagePaths(this.deps.storage.paths.home).suggestionsPath
    );
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

function effectiveDefinitions(
  definitions: PromptSuggestionDefinition[],
): PromptSuggestionDefinition[] {
  const byName = new Map<string, PromptSuggestionDefinition>();
  for (const definition of definitions) {
    if (!byName.has(definition.name)) byName.set(definition.name, definition);
  }
  return [...byName.values()];
}

function statusesFor(
  definitions: PromptSuggestionDefinition[],
  trustRecords: Awaited<ReturnType<PromptSuggestionTrustRepository["list"]>>,
): PromptSuggestionStatus[] {
  const winnerByName = new Map<string, PromptSuggestionDefinition>();
  for (const definition of definitions) {
    if (!winnerByName.has(definition.name)) {
      winnerByName.set(definition.name, definition);
    }
  }
  return definitions.map((definition) => {
    const trustRecord = definition.trustId
      ? trustRecords.find((record) => record.trustId === definition.trustId)
      : undefined;
    const winner = winnerByName.get(definition.name);
    return {
      trustId: definition.trustId,
      definitionKey: definition.definitionKey,
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
      enabled: definition.enabled,
      defaultEnabled: definition.defaultEnabled,
      overriddenBy:
        winner && winner.definitionKey !== definition.definitionKey
          ? winner.source.kind
          : undefined,
      predicateHash: definition.predicateHash,
    };
  });
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
    byKey.set(status.definitionKey, status);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      sourceOrder(left.sourceKind) - sourceOrder(right.sourceKind) ||
      left.label.localeCompare(right.label) ||
      left.path.localeCompare(right.path),
  );
}

function sourceOrder(kind: PromptSuggestionStatus["sourceKind"]): number {
  return kind === "builtin" ? 0 : kind === "user" ? 1 : 2;
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
      definitionKey: `stale:${record.trustId}`,
      name: record.name,
      label: record.label,
      path: record.path,
      sourceKind: record.sourceKind,
      requiresTrust: true,
      status: "stale" as const,
      enabled: false,
      defaultEnabled: false,
      predicateHash: record.predicateHash,
      stale: true,
    }));
}

async function assertDirectoryInsideProject(
  projectDir: string,
  destinationDir: string,
): Promise<void> {
  const [projectRoot, destination] = await Promise.all([
    realpath(projectDir),
    realpath(destinationDir),
  ]);
  const child = relative(projectRoot, destination);
  if (
    child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))
  ) {
    return;
  }
  throw new Error(
    "Prompt suggestion destination escapes the project directory.",
  );
}
