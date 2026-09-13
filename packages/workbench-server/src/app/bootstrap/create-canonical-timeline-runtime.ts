import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import { CanonicalRunExecutionBoundary } from "../../domains/agents/execution/canonical-run-execution-boundary.js";
import { FilesystemCanonicalArtifactFinalizer } from "../../infrastructure/persistence/canonical-artifact-finalizer.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import { CanonicalAutoCompactionService } from "../../domains/conversations/timeline/canonical-auto-compaction.service.js";
import { CanonicalConversationContextService } from "../../domains/conversations/timeline/canonical-conversation-context.service.js";
import { CanonicalConversationCreationService } from "../../domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalDeletionCleanupService } from "../../domains/conversations/timeline/canonical-deletion-cleanup.service.js";
import { CanonicalDeletionDispatcher } from "../../domains/conversations/timeline/canonical-deletion-dispatcher.js";
import { CanonicalDeletionService } from "../../domains/conversations/timeline/canonical-deletion.service.js";
import { CanonicalNavigationService } from "../../domains/conversations/timeline/canonical-navigation.service.js";
import { CanonicalProjectionDispatcher } from "../../domains/conversations/timeline/canonical-projection-dispatcher.js";
import { CanonicalProviderPreparationService } from "../../domains/conversations/timeline/canonical-provider-preparation.service.js";
import { CanonicalProviderDispatchService } from "../../domains/conversations/timeline/canonical-provider-dispatch.service.js";
import { CanonicalProviderSettlementService } from "../../domains/conversations/timeline/canonical-provider-settlement.service.js";
import { CanonicalRunStartService } from "../../domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTerminationService } from "../../domains/conversations/timeline/canonical-run-termination.service.js";
import { CanonicalRunTimelineService } from "../../domains/conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalTimelinePageProvider } from "../../domains/conversations/timeline/canonical-timeline-page-provider.js";
import { CanonicalTranscriptProjectionService } from "../../domains/conversations/timeline/canonical-transcript-projection.service.js";
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
    conversationCreation,
    conversationContext,
    runStart,
    runTimeline,
    runTermination,
    providerPreparation,
    providerDispatch,
    providerSettlement,
    runExecutionBoundary,
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
