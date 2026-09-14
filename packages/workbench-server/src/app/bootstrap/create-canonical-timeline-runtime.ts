import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import { CanonicalRunExecutionBoundary } from "../../domains/agents/execution/canonical-run-execution-boundary.js";
import { createCanonicalAgentTools } from "../../domains/agents/execution/canonical-agent-tools.js";
import { CanonicalExecutionRuntime } from "../../domains/agents/execution/canonical-execution-runtime.js";
import { CanonicalHarnessLifecycleExecutor } from "../../domains/agents/execution/canonical-harness-lifecycle-executor.js";
import { CanonicalLiveRunExecutor } from "../../domains/agents/execution/canonical-live-run-executor.js";
import type { WorkbenchAgentMechanics } from "../../domains/agents/execution/workbench-agent-mechanics.js";
import { FilesystemCanonicalArtifactFinalizer } from "../../infrastructure/persistence/canonical-artifact-finalizer.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import { CanonicalAutoCompactionService } from "../../domains/conversations/timeline/canonical-auto-compaction.service.js";
import { CanonicalConversationApplicationService } from "../../domains/conversations/timeline/canonical-conversation-application.service.js";
import { CanonicalConversationContextService } from "../../domains/conversations/timeline/canonical-conversation-context.service.js";
import { CanonicalContinuationService } from "../../domains/conversations/timeline/canonical-continuation.service.js";
import { CanonicalConversationCreationService } from "../../domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalDeletionCleanupService } from "../../domains/conversations/timeline/canonical-deletion-cleanup.service.js";
import { CanonicalDeletionDispatcher } from "../../domains/conversations/timeline/canonical-deletion-dispatcher.js";
import { CanonicalDeletionService } from "../../domains/conversations/timeline/canonical-deletion.service.js";
import { CanonicalInteractionResolutionService } from "../../domains/conversations/timeline/canonical-interaction-resolution.service.js";
import { CanonicalLifecycleDispatcher } from "../../domains/conversations/timeline/canonical-lifecycle-dispatcher.js";
import { CanonicalNavigationService } from "../../domains/conversations/timeline/canonical-navigation.service.js";
import { CanonicalProjectionDispatcher } from "../../domains/conversations/timeline/canonical-projection-dispatcher.js";
import { CanonicalProviderPreparationService } from "../../domains/conversations/timeline/canonical-provider-preparation.service.js";
import { CanonicalProviderDispatchService } from "../../domains/conversations/timeline/canonical-provider-dispatch.service.js";
import { CanonicalProviderSettlementService } from "../../domains/conversations/timeline/canonical-provider-settlement.service.js";
import { CanonicalProviderInvocationService } from "../../domains/conversations/timeline/canonical-provider-invocation.service.js";
import { CanonicalRunStartService } from "../../domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTerminationService } from "../../domains/conversations/timeline/canonical-run-termination.service.js";
import { CanonicalRunTimelineService } from "../../domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalTimelinePageProvider } from "../../domains/conversations/timeline/canonical-timeline-page-provider.js";
import { CanonicalTranscriptProjectionService } from "../../domains/conversations/timeline/canonical-transcript-projection.service.js";
import { CanonicalToolDispatchService } from "../../domains/conversations/timeline/canonical-tool-dispatch.service.js";
import { CanonicalToolSettlementService } from "../../domains/conversations/timeline/canonical-tool-settlement.service.js";
import { CanonicalToolInvocationService } from "../../domains/conversations/timeline/canonical-tool-invocation.service.js";
import { CanonicalToolWorkerService } from "../../domains/conversations/timeline/canonical-tool-worker.service.js";
import type { CanonicalToolExternalInvoker } from "../../domains/tools/execution/canonical-tool-external-invoker.js";
import type { ToolService } from "../../domains/tools/execution/tool-service.js";
import { CanonicalBackupInspectionService } from "../../domains/storage/canonical-backup-inspection.service.js";
import { CanonicalPortableBackupService } from "../../domains/storage/canonical-portable-backup.service.js";
import { CanonicalRestoreStagingService } from "../../domains/storage/canonical-restore-staging.service.js";

export function timelineRuntime(
  storage: InitializedStorage,
  secrets: SecretProvider,
  logger: ApplicationLogger,
) {
  const timelinePages = new CanonicalTimelinePageProvider(
    storage.canonicalStore,
    secrets,
  );
  const conversationCreation = new CanonicalConversationCreationService(
    storage.canonicalStore,
  );
  const conversationContext = new CanonicalConversationContextService(
    storage.canonicalStore,
  );
  const continuation = new CanonicalContinuationService(storage.canonicalStore);
  const runStart = new CanonicalRunStartService(storage.canonicalStore);
  const runTimeline = new CanonicalRunTimelineService(storage.canonicalStore);
  const providerPreparation = new CanonicalProviderPreparationService(
    storage.canonicalStore,
  );
  const providerDispatch = new CanonicalProviderDispatchService(
    storage.canonicalStore,
  );
  const providerSettlement = new CanonicalProviderSettlementService(
    storage.canonicalStore,
  );
  const providerInvocation = new CanonicalProviderInvocationService(
    storage.canonicalStore,
  );
  const toolDispatch = new CanonicalToolDispatchService(storage.canonicalStore);
  const toolSettlement = new CanonicalToolSettlementService(
    storage.canonicalStore,
  );
  const toolInvocation = new CanonicalToolInvocationService(
    storage.canonicalStore,
  );
  const navigation = new CanonicalNavigationService(storage.canonicalStore);
  const runTermination = new CanonicalRunTerminationService(
    storage.canonicalStore,
  );
  const runExecutionBoundary = new CanonicalRunExecutionBoundary(
    runStart,
    conversationContext,
    runTimeline,
    runTermination,
  );
  const autoCompaction = new CanonicalAutoCompactionService(
    storage.canonicalStore,
    new FilesystemCanonicalArtifactFinalizer(storage.paths.home),
  );
  const projections = new CanonicalTranscriptProjectionService(
    storage.canonicalStore,
  );
  const dispatcher = new CanonicalProjectionDispatcher(
    projections,
    logger.child({ component: "canonical-projections" }),
  );
  dispatcher.start();
  const deletion = new CanonicalDeletionService(storage.canonicalStore);
  const deletionDispatcher = new CanonicalDeletionDispatcher(
    storage.canonicalStore,
    new CanonicalDeletionCleanupService(storage.canonicalStore, storage.paths),
    logger.child({ component: "canonical-deletion" }),
  );
  deletionDispatcher.start();
  const portableBackup = new CanonicalPortableBackupService(
    storage.canonicalStore,
    storage.paths,
  );
  const backupInspection = new CanonicalBackupInspectionService(storage.paths);
  const restoreStaging = new CanonicalRestoreStagingService(storage.paths);
  return {
    timelinePages,
    createConversationApplication: (
      input: Omit<
        ConstructorParameters<
          typeof CanonicalConversationApplicationService
        >[0],
        "storage" | "deletion"
      >,
    ) =>
      new CanonicalConversationApplicationService({
        ...input,
        storage,
        deletion,
      }),
    conversationCreation,
    conversationContext,
    continuation,
    runStart,
    runTimeline,
    runTermination,
    providerPreparation,
    providerDispatch,
    providerSettlement,
    providerInvocation,
    toolDispatch,
    toolSettlement,
    toolInvocation,
    runExecutionBoundary,
    createInteractionResolution: (
      tools: ToolService,
      getAgentForConversation: ConstructorParameters<
        typeof CanonicalInteractionResolutionService
      >[2],
    ) =>
      new CanonicalInteractionResolutionService(
        storage.canonicalStore,
        tools,
        getAgentForConversation,
      ),
    createExecutionRuntime: (input: {
      workerId: string;
      mechanics: WorkbenchAgentMechanics;
      tools: ToolService;
      getAgentForConversation(
        conversationId: string,
      ):
        | Parameters<WorkbenchAgentMechanics["activeToolNamesFor"]>[0]
        | undefined;
      getConversationCreatedAt(conversationId: string): string;
      onForegroundClosed?(conversationId: string): Promise<void>;
    }) => {
      const harness = new CanonicalHarnessLifecycleExecutor({
        mechanics: input.mechanics,
        boundary: runExecutionBoundary,
        providerInvocation,
        providerSettlement,
        store: storage.canonicalStore,
      });
      const toolWorker = new CanonicalToolWorkerService(
        storage.canonicalStore,
        input.tools.canonicalInvoker,
      );
      const execution = new CanonicalExecutionRuntime({
        store: storage.canonicalStore,
        live: new CanonicalLiveRunExecutor({
          store: storage.canonicalStore,
          mechanics: input.mechanics,
          harness,
          toolWorker,
          tools: input.tools,
        }),
        toolWorker,
        continuation,
        ...input,
      });
      const lifecycle = new CanonicalLifecycleDispatcher(
        storage.canonicalStore,
        input.workerId,
        execution.handlers,
        logger.child({ component: "canonical-lifecycle" }),
      );
      return {
        start: () => lifecycle.start(),
        wake: () => lifecycle.wake(),
        stop: () => lifecycle.stop(),
        settled: () => lifecycle.settled(),
      };
    },
    createLiveRunExecutor: (
      mechanics: WorkbenchAgentMechanics,
      tools: ToolService,
    ) => {
      const harness = new CanonicalHarnessLifecycleExecutor({
        mechanics,
        boundary: runExecutionBoundary,
        providerInvocation,
        providerSettlement,
        store: storage.canonicalStore,
      });
      const toolWorker = new CanonicalToolWorkerService(
        storage.canonicalStore,
        tools.canonicalInvoker,
      );
      return new CanonicalLiveRunExecutor({
        store: storage.canonicalStore,
        mechanics,
        harness,
        toolWorker,
        tools,
      });
    },
    createAgentTools: (
      input: Omit<Parameters<typeof createCanonicalAgentTools>[0], "store">,
    ) => createCanonicalAgentTools({ ...input, store: storage.canonicalStore }),
    createToolWorker: (external: CanonicalToolExternalInvoker) =>
      new CanonicalToolWorkerService(storage.canonicalStore, external),
    createLifecycleDispatcher: (
      workerId: string,
      handlers: ConstructorParameters<typeof CanonicalLifecycleDispatcher>[2],
    ) =>
      new CanonicalLifecycleDispatcher(
        storage.canonicalStore,
        workerId,
        handlers,
        logger.child({ component: "canonical-lifecycle" }),
      ),
    createHarnessExecutor: (mechanics: WorkbenchAgentMechanics) =>
      new CanonicalHarnessLifecycleExecutor({
        mechanics,
        boundary: runExecutionBoundary,
        providerInvocation,
        providerSettlement,
        store: storage.canonicalStore,
      }),
    autoCompaction,
    navigation,
    deletion,
    projectionDispatcher: dispatcher,
    deletionDispatcher,
    portableBackup,
    backupInspection,
    restoreStaging,
  };
}
