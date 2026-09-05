import type { Message } from "@earendil-works/pi-ai";
import type { AuthManager } from "../../domains/auth/index.js";
import type { AgentBrowserSkillCatalog } from "../../domains/agents/prompting/agent-browser-skills.js";
import type { ProviderCatalogStore } from "../../domains/providers/index.js";
import type { SubscriptionUsageService } from "../../domains/usage/subscription-usage-service.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import {
  composeRuntime,
  type RuntimeServices,
} from "../bootstrap/create-runtime-services.js";
import { RuntimeState } from "./runtime-projections.js";
import {
  RuntimeHydrator,
  type RuntimeBootstrapStage,
  type RuntimeHydrationTimings,
  type StoreHydrationOperation,
} from "../bootstrap/hydrate-runtime.js";

export type {
  RuntimeHydrationCounts,
  RuntimeHydrationTimings,
  StoreHydrationDurations,
} from "../bootstrap/hydrate-runtime.js";
export { settleMeasuredHydrationOperations } from "../bootstrap/hydrate-runtime.js";

export class RuntimeLifecycle {
  private readonly state = new RuntimeState();
  readonly projects = this.state.projects;
  readonly conversations = this.state.conversations;
  readonly agents = this.state.agents;
  readonly entries = this.state.entries;
  readonly conversationRuntime = this.state.conversationRuntime;

  get agentConversationMessages(): Map<string, Message[]> {
    return this.state.agentConversationMessages;
  }
  private readonly services: RuntimeServices;
  private readonly backgroundOperations = new Set<Promise<void>>();
  private shuttingDown = false;

  static compose(
    storage: InitializedStorage,
    events: StreamLogRegistry,
    queryCache: RuntimeQueryCache,
    auth: AuthManager,
    secrets: SecretProvider,
    subscriptionUsage: SubscriptionUsageService,
    logger: ApplicationLogger,
    agentBrowserSkills: AgentBrowserSkillCatalog,
    providerCatalog: ProviderCatalogStore,
    performanceDiagnostics: PerformanceDiagnosticsPort,
  ): { lifecycle: RuntimeLifecycle; services: RuntimeServices } {
    const lifecycle = new RuntimeLifecycle(
      storage,
      events,
      queryCache,
      auth,
      secrets,
      subscriptionUsage,
      logger,
      agentBrowserSkills,
      providerCatalog,
      performanceDiagnostics,
    );
    return { lifecycle, services: lifecycle.services };
  }

  private constructor(
    storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly queryCache: RuntimeQueryCache,
    private readonly auth: AuthManager,
    secrets: SecretProvider,
    subscriptionUsage: SubscriptionUsageService,
    private readonly logger: ApplicationLogger,
    agentBrowserSkills: AgentBrowserSkillCatalog,
    providerCatalog: ProviderCatalogStore,
    performanceDiagnostics: PerformanceDiagnosticsPort,
  ) {
    this.services = composeRuntime(this.state, {
      storage,
      events,
      queryCache,
      auth,
      secrets,
      providerCatalog,
      subscriptionUsage,
      logger,
      agentBrowserSkills,
      performanceDiagnostics,
    });
    this.hydrator = new RuntimeHydrator({
      withUpdatesDeferred: (operation) =>
        this.queryCache.withUpdatesDeferred(operation),
      hydrateStores: [
        {
          name: "auth",
          run: () => this.auth.refreshModels({ allowNetwork: false }),
        },
        { name: "providers", run: () => providerCatalog.load() },
        { name: "tasks", run: () => this.services.tasks.hydrate() },
        { name: "tools", run: () => this.services.tools.hydrate() },
        { name: "plans", run: () => this.services.plans.hydrate() },
        {
          name: "projects",
          run: () => this.services.projectLifecycle.loadProjects(),
        },
        {
          name: "conversations",
          run: () => this.services.conversationLifecycle.loadConversations(),
        },
      ] as const satisfies readonly StoreHydrationOperation[],
      loadAgents: () => this.services.agentLifecycle.loadAgents(),
      flushRunDelivery: () => this.services.runRuntime.delivery.flush(),
      recoverRuns: async () => {
        await this.services.runRuntime.coordinator.recover();
      },
      recoverHumanInput: async () => {
        await this.services.humanInput.startApprovalSettlement();
        await this.services.humanInput.recoverAcceptedPlanReviews();
      },
      rebuildProjector: async () => {
        const activeStates =
          await this.services.runRuntime.unitOfWork.listActive();
        const runRecords =
          await this.services.runRuntime.unitOfWork.listMetadata();
        await this.services.runRuntime.projector.rebuild({
          activeStates,
          runRecords,
        });
        return {
          runMetadata: runRecords.length,
          activeRuns: activeStates.length,
        };
      },
      counts: () => ({
        projects: this.services.projectLifecycle.listProjects().length,
        conversations:
          this.services.conversationLifecycle.listConversations().length,
        agents: this.services.agentLifecycle.listAgents().length,
        tasks: this.services.tasks.listTasks().length,
        toolCalls: this.services.tools.countToolCalls(),
      }),
      recoverTaskNotifications: () =>
        this.services.taskNotifications.recoverPendingNotifications(),
      rebuildIndex: () => this.rebuildIndex(),
      hydratePromptSuggestions: () => this.services.promptSuggestions.hydrate(),
      toolCallHydrationSource: this.services.tools.toolCallHydrationSource,
    });
  }

  private readonly hydrator: RuntimeHydrator;

  /**
   * Stops lifecycle timers and waits for run executions, transition
   * projections, event deliveries, and journal publications to settle so no
   * writer races teardown.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.services.gitRepositoryWatcher.close();
    this.services.projectFilesystemWatcher.close();
    await this.services.humanInput.stopApprovalSettlement();
    await this.services.tasks.shutdown();
    this.services.taskNotifications.stop();
    await Promise.allSettled([...this.backgroundOperations]);
    await this.services.runRuntime.coordinator.settled();
    await this.services.runRuntime.delivery.settled();
    await this.events.settled();
    await this.services.conversationJournal
      .checkpointLoaded()
      .catch(async (error: unknown) => {
        await this.logger.warn(
          "Conversation checkpoint failed during shutdown",
          {
            error,
          },
        );
      });
  }

  async hydrate(
    reportStage?: (stage: RuntimeBootstrapStage) => void,
  ): Promise<RuntimeHydrationTimings> {
    return this.hydrator.hydrate(reportStage);
  }
  async refreshRuntimeCapabilities(): Promise<void> {
    if (this.shuttingDown) return;
    const operations = [
      ["Python runtime discovery", this.services.pythonRuntime.refresh()],
      ["Editor discovery", this.services.editors.refresh()],
      ["Terminal discovery", this.services.terminal.refresh()],
    ] as const;
    await this.logSettledOperations(operations);
  }

  startBackgroundMaintenance(): void {
    if (this.shuttingDown) return;
    const operations = [
      ["Network model refresh", this.auth.refreshModels()],
      [
        "Tool-result payload reconciliation",
        this.services.tools.reconcileResultPayloads(),
      ],
      [
        "Conversation projection backfill",
        this.services.conversationJournal.backfillMissingProjections(),
      ],
    ] as const;
    this.trackBackgroundOperation(this.logSettledOperations(operations));
  }

  private async logSettledOperations(
    operations: readonly (readonly [string, Promise<unknown>])[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      operations.map(([, operation]) => operation),
    );
    await Promise.all(
      results.map((result, queryCache) =>
        result.status === "rejected"
          ? this.logger.warn(`${operations[queryCache]?.[0]} failed`, {
              error: result.reason,
            })
          : undefined,
      ),
    );
  }

  private trackBackgroundOperation(operation: Promise<void>): void {
    this.backgroundOperations.add(operation);
    void operation
      .catch(() => undefined)
      .finally(() => this.backgroundOperations.delete(operation));
  }

  /** Rebuild the disposable derived SQLite queryCache from repositories. */
  async rebuildIndex(): Promise<void> {
    this.queryCache.rebuild({
      projects: this.services.projectLifecycle.listProjects(),
      conversations: this.services.conversationLifecycle.listConversations(),
      agents: this.services.agentLifecycle.listAgents(),
      tasks: this.services.tasks.listTasks(),
    });
  }
}
