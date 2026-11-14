import {
  createdPrReference,
  referenceMatchesRepository,
} from "../../domains/git/pr-sync/pr-reference-signal.js";
import { PrSyncService } from "../../domains/git/pr-sync/pr-sync-service.js";
import { GitBackgroundFetch } from "../../domains/git/workspace-sync/git-background-fetch-service.js";
import { GitWorkspaceSync } from "../../domains/git/workspace-sync/git-workspace-sync-service.js";
import { UnreadableConversationActivity } from "../../domains/activity/unreadable-conversation-activity.js";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import {
  projectConfigurationDescriptors,
  projectConfigurationTrustKinds,
} from "../../infrastructure/configuration/project-migration/descriptors.js";
import { projectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration-trust.js";
import { allToolDescriptors } from "@nervekit/tools/catalog";
import { hostRegistry, registerHostTools } from "../../core-host/host-tools.js";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { UnifiedCompletionService } from "../../domains/completions/unified-completion-service.js";
import { createCompletionDependencies } from "./create-completion-dependencies.js";
import { createWorkspaceMonitorPublisher } from "./workspace-monitor-publisher.js";
import { ActivityService } from "../../domains/activity/activity.service.js";
import {
  PromptSuggestionService,
  PromptSuggestionTrustRepository,
} from "../../domains/prompt-suggestions/index.js";
import { PromptSuggestionEnablementService } from "../../domains/prompt-suggestions/prompt-suggestion-enablement.service.js";
import type { AuthManager } from "../../domains/auth/index.js";
import { AccountsService } from "../../domains/accounts/index.js";
import { extensionAccountTester } from "../../domains/auth/account-testers.js";
import { IntegrationHealthService } from "../../domains/auth/integration-health.service.js";
import type { ProviderCatalogStore } from "../../domains/providers/provider-catalog.store.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { ResourceLimits } from "@nervekit/contracts/settings";
import type { NerveSkillCatalog } from "../../builtin-skills/index.js";
import type { AgentBrowserSkillCatalog } from "../../core-host/agent-browser-skills.js";
import { CoreScratchNoteService } from "../../core-host/scratch-note.service.js";
import { createConversationCore } from "./create-conversation-core.js";
import { createWorkbenchLaunchResources } from "../../domains/launches/adapters/workbench-launch-adapters.js";
import { LaunchService } from "../../domains/launches/application/launch.service.js";
import {
  LaunchDefinitionRepository,
  LaunchDefinitionService,
} from "../../domains/launch-definitions/index.js";
import { LaunchDefinitionOperations } from "../../domains/launch-definitions/launch-definition-operations.js";
import { ProjectEditorService } from "../../domains/projects/project-editor.service.js";
import { ProjectTerminalService } from "../../domains/projects/project-terminal.service.js";
import { ProjectIconService } from "../../domains/projects/project-icon.service.js";
import { GitService, GitOperationService } from "@nervekit/tools/git";
import {
  isProjectWideMutation,
  withGitMutationReporting,
} from "../../domains/git/git-mutation-publisher.js";
import { WorkspaceMonitor } from "../../domains/monitoring/workspace-monitor.js";
import { projectPathIndexes } from "../../domains/filesystem/project-path-index.js";

export interface RuntimeDeps {
  storage: InitializedStorage;
  events: WorkbenchNoticePublisher;
  auth: AuthManager;
  secrets: SecretProvider;
  providerCatalog: ProviderCatalogStore;
  subscriptionUsage: SubscriptionUsageService;
  logger: ApplicationLogger;
  nerveSkills: NerveSkillCatalog;
  agentBrowserSkills: AgentBrowserSkillCatalog;
  performanceDiagnostics: PerformanceDiagnosticsPort;
  resources: ResourceLimits & { controlWorkConcurrency: number };
}
export type RuntimeServices = ReturnType<typeof createRuntimeServices>;

export function createRuntimeServices(deps: RuntimeDeps) {
  registerHostTools();
  const { storage, events, auth, logger } = deps;
  const activities = new ActivityService((activity, removed) =>
    events.publish("activity.updated", { activity, removed }),
  );
  const unreadableConversations = new UnreadableConversationActivity({
    activities,
    lookup: (id) => coreStorage.conversations.rawIdentity(id),
    delete: (id) => conversationCore.delete(id),
  });
  const getProject = (id: string) => {
    const project = conversationCore.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  };
  const listProjects = () => conversationCore.projects.list();
  const launches = new LaunchService(
    createWorkbenchLaunchResources(storage, events, logger, {}),
  );
  const projectMigration = new ProjectMigrationService({
    home: storage.paths.home,
    trust: projectMigrationTrust(
      () => coreStorage,
      projectConfigurationTrustKinds,
    ),
    changed: (health) => {
      void events
        .publish("project.configuration.health", health)
        .catch((error) => {
          void logger.error("Could not publish project configuration health", {
            error,
          });
        });
    },
  });
  for (const { type } of projectConfigurationDescriptors)
    projectMigration.register(type);
  const launchDefinitions = new LaunchDefinitionService(
    new LaunchDefinitionRepository(getProject, projectMigration),
    getProject,
    async (type, data) => {
      await events.publish(type, data);
    },
  );
  const accountKinds = () =>
    hostRegistry.extensions.flatMap((extension) => extension.accounts ?? []);
  const accounts = new AccountsService({ storage, auth, kinds: accountKinds });
  const {
    conversationTitles,
    core: conversationCore,
    storage: coreStorage,
    agentConfiguration,
    extensionSettings,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
  } = createConversationCore(
    { ...deps, accounts },
    { launches, definitions: launchDefinitions },
    // Lazy: completion project lookup depends on the constructed core.
    async (projectId) => {
      await completions.dispose(projectId);
      git.invalidateProjectReads(projectId);
    },
    undefined,
    projectMigration,
    ({ conversationId, error }) =>
      unreadableConversations.report(conversationId, error),
  );
  conversationCore.subscribe((change) => {
    if (change.kind === "conversation_deleted")
      unreadableConversations.forget(change.conversationId);
  });
  const launchDefinitionOperations = new LaunchDefinitionOperations(
    launchDefinitions,
    launches,
    listProjects,
  );
  const scratchNotes = new CoreScratchNoteService(
    coreStorage,
    async (projectId) => {
      await events.publish("scratchNote.changed", { projectId });
    },
  );
  const integrationHealth = new IntegrationHealthService({
    accounts,
    kinds: accountKinds,
    test: extensionAccountTester({
      registry: hostRegistry,
      accounts,
      warn: (extensionId, message, data) =>
        void deps.logger.warn("Extension warning", {
          context: { extension: extensionId, message, data },
        }),
    }),
    publish: async (kind, accountId) => {
      await events.publish("accounts.health_changed", { kind, accountId });
    },
  });
  const gitService = new GitService((id) => {
    const project = getProject(id);
    return { id: project.id, name: project.name, dir: project.directory };
  });
  // The decorator is the sole success-event publisher for both tracked and direct mutations.
  const prSync = new PrSyncService(gitService, events);
  const seenCreatedReferences = new Set<string>();
  prSync.disposers.push(
    conversationCore.subscribe((change) => {
      if (change.kind !== "conversation_changed") return;
      const { projectId, references } = change.summary;
      for (const reference of references) {
        const created = createdPrReference(reference);
        const key = `${projectId}:${reference.resourceKey}`;
        if (!created || seenCreatedReferences.has(key)) continue;
        seenCreatedReferences.add(key);
        void gitService
          .discoverRepos(projectId)
          .then(async (discovery) => {
            for (const repo of discovery.repos) {
              const remote = await gitService.repoRemoteState(
                gitService.resolveRepoDir(projectId, repo.relativePath),
              );
              if (referenceMatchesRepository(created, remote.githubRepository))
                prSync.signal(projectId, repo.relativePath, created.number);
            }
          })
          .catch(() => {});
      }
    }),
  );
  // Constructed after the monitor and the decorated service it reads through.
  const workspaceSyncRef: { current?: GitWorkspaceSync } = {};
  const git = withGitMutationReporting(
    gitService,
    activities,
    (method, projectId, repo, branch, number) => {
      if (isProjectWideMutation(method))
        workspaceSyncRef.current?.markProjectDirty(projectId, {
          priority: true,
        });
      else
        workspaceSyncRef.current?.markDirty(projectId, repo, {
          priority: true,
        });
      if (method === "mergePr" && number)
        prSync.merged(projectId, repo, number);
      else if ((method === "push" || method === "syncBranch") && branch)
        prSync.expect(projectId, repo, branch);
      else prSync.signal(projectId, repo);
    },
  );
  const gitOperations = new GitOperationService(git, activities);
  const workspaceMonitor = new WorkspaceMonitor(
    createWorkspaceMonitorPublisher(events, git),
    {
      onProjectChanged: (projectId, changedPaths) =>
        projectPathIndexes.notifyChanged(projectId, changedPaths),
      onRemoteRefsChanged: (projectId, repo, branches) => {
        if (branches.length)
          for (const branch of branches) prSync.expect(projectId, repo, branch);
        else prSync.signal(projectId, repo);
      },
      onRepositoryNotice: (projectId, repo, options) => {
        // A repository notice must not abort reads of the project's other repositories.
        git.invalidateRepoReads(
          projectId,
          repo,
          options?.refreshCause === "uncertain_poll"
            ? { uncertain: true }
            : undefined,
        );
        workspaceSyncRef.current?.onNotice(projectId, repo, options);
      },
      onRepositoryChanged: (repoDir, options) => {
        if (options?.refreshCause !== "uncertain_poll")
          gitService.invalidateStableRepoMetadata(repoDir);
      },
      onWarning: (message, error) => {
        void logger.warn(message, { error });
      },
    },
  );
  const workspaceSync = new GitWorkspaceSync(git, workspaceMonitor, events, {
    onBranchChanged: (change) => prSync.branchChanged(change),
  });
  workspaceSyncRef.current = workspaceSync;
  // Quiet `git fetch` for visible repositories; moved remote refs refresh summaries and PRs.
  const backgroundFetch = new GitBackgroundFetch(
    gitService,
    { candidates: () => workspaceSync.backgroundFetchCandidates() },
    (members) => {
      for (const { projectId, repo } of members) {
        workspaceSync.markDirty(projectId, repo);
        prSync.signal(projectId, repo);
      }
    },
  );
  backgroundFetch.start();
  const promptSuggestionEnablement = new PromptSuggestionEnablementService(
    storage.paths.configPath,
  );
  const promptSuggestions = new PromptSuggestionService({
    projectMigration,
    storage,
    events,
    trustRepository: new PromptSuggestionTrustRepository(
      conversationCore.trust,
    ),
    enablementRepository: promptSuggestionEnablement,
    git: gitService,
    getProject: (id) => {
      const project = getProject(id);
      return { id: project.id, name: project.name, dir: project.directory };
    },
    listProjects: () =>
      listProjects().map((project) => ({
        id: project.id,
        name: project.name,
        dir: project.directory,
      })),
    getConversation: (id) => conversationCore.getSnapshot(id),
    openPullRequestForBranch: (projectId, repo, branch) => {
      const snapshot = prSync.snapshot(projectId, repo);
      if (
        snapshot.updatedAt === null ||
        snapshot.status === "unavailable" ||
        snapshot.status === "unauthenticated"
      )
        return undefined;
      const pr = snapshot.prs
        .filter((pr) => pr.state === "OPEN" && pr.headRefName === branch)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return pr
        ? {
            number: pr.number,
            url: pr.url,
            isDraft: pr.isDraft,
            checks: pr.checks.status,
            checksRunning: pr.checks.pending > 0,
            reviewRequested: pr.reviewRequested,
          }
        : null;
    },
    getAgentContext: async (id) => {
      const view = await agentConfiguration.getEffective(id);
      if (view.status !== "available") return undefined;
      const { permissionRuleSetId, reasoningLevel } = view.resolution.settings;
      return permissionRuleSetId && reasoningLevel
        ? { permissionRuleSetId, reasoningLevel }
        : undefined;
    },
  });
  const completionMetadata = (id: string) => {
    const conversation = coreStorage.conversations.get(id);
    if (!conversation) throw new Error("Conversation not found");
    return {
      projectId: conversation.projectId,
      lastSequence: coreStorage.events.lastSequence(id),
    };
  };
  const completions: UnifiedCompletionService = new UnifiedCompletionService(
    createCompletionDependencies({
      home: storage.paths.home,
      git: {
        discoverRepos: git.discoverRepos.bind(git),
        listIssues: git.listIssues.bind(git),
        onRemoteCacheChanged: git.onRemoteCacheChanged.bind(git),
        cachedOpenPrs: prSync.cachedOpenPrs.bind(prSync),
      },
      events,
      core: conversationCore,
      context: {
        metadata: completionMetadata,
        history: (id, page) =>
          conversationCore.getHistory(id, {
            limit: Math.min(64, Math.max(1, page.limit)),
          }),
        project: getProject,
      },
      sources: {
        project: getProject,
        configuration: agentConfiguration,
        isProjectAgentTrusted: (projectId, path, digest) =>
          conversationCore.trust.isTrusted(
            "project_capabilities",
            projectId,
            path,
            digest,
          ),
        tools: allToolDescriptors(),
        skills: async (scope) =>
          (
            await listAvailableSkills(getProject(scope.projectId).directory, {
              storageHome: storage.paths.home,
              nerveSkills: deps.nerveSkills.skills,
              agentBrowserSkills: deps.agentBrowserSkills.skills,
            })
          ).skills,
        launches: () => launches.list(),
        definitions: (projectId) => launchDefinitions.catalog(projectId),
        children: (scope) =>
          scope.conversationId
            ? coreStorage.conversations.list({
                projectId: scope.projectId,
                parentConversationId: scope.conversationId,
              })
            : [],
      },
    }),
  );
  return {
    unreadableConversations,
    projectMigration,
    completions,
    activities,
    promptSuggestionEnablement,
    promptSuggestions,
    conversationTitles,
    conversationCore,
    agentConfiguration,
    extensionSettings,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
    coreStorage,
    launches,
    launchDefinitions,
    launchDefinitionOperations,
    scratchNotes,
    accounts,
    integrationHealth,
    workspaceMonitor,
    prSync,
    workspaceSync,
    backgroundFetch,
    git,
    gitOperations,
    editors: new ProjectEditorService(getProject),
    terminal: new ProjectTerminalService(getProject),
    projectIcons: new ProjectIconService(getProject),
  };
}
