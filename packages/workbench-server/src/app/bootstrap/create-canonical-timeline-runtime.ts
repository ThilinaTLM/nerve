import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import { CanonicalProjectionDispatcher } from "../../domains/conversations/timeline/canonical-projection-dispatcher.js";
import { CanonicalTimelinePageProvider } from "../../domains/conversations/timeline/canonical-timeline-page-provider.js";
import { CanonicalTranscriptProjectionService } from "../../domains/conversations/timeline/canonical-transcript-projection.service.js";
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
  const portableBackup = new CanonicalPortableBackupService(
    storage.canonicalStore,
    storage.paths,
  );
  return {
    timelinePages,
    projectionDispatcher: dispatcher,
    portableBackup,
  };
}
