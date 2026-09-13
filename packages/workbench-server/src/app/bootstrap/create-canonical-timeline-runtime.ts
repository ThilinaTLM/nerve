import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import { CanonicalDeletionCleanupService } from "../../domains/conversations/timeline/canonical-deletion-cleanup.service.js";
import { CanonicalDeletionDispatcher } from "../../domains/conversations/timeline/canonical-deletion-dispatcher.js";
import { CanonicalProjectionDispatcher } from "../../domains/conversations/timeline/canonical-projection-dispatcher.js";
import { CanonicalTimelinePageProvider } from "../../domains/conversations/timeline/canonical-timeline-page-provider.js";
import { CanonicalTranscriptProjectionService } from "../../domains/conversations/timeline/canonical-transcript-projection.service.js";
import { CanonicalBackupInspectionService } from "../../domains/storage/canonical-backup-inspection.service.js";
import { CanonicalPortableBackupService } from "../../domains/storage/canonical-portable-backup.service.js";

export function timelineRuntime(
  storage: InitializedStorage,
  secrets: SecretProvider,
  logger: ApplicationLogger,
) {
  const timelinePages = new CanonicalTimelinePageProvider(
    storage.canonicalStore,
    secrets,
  );
  const projections = new CanonicalTranscriptProjectionService(
    storage.canonicalStore,
  );
  const dispatcher = new CanonicalProjectionDispatcher(
    projections,
    logger.child({ component: "canonical-projections" }),
  );
  dispatcher.start();
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
  return {
    timelinePages,
    projectionDispatcher: dispatcher,
    deletionDispatcher,
    portableBackup,
    backupInspection,
  };
}
