import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";
import { CanonicalProjectionDispatcher } from "../../domains/conversations/timeline/canonical-projection-dispatcher.js";
import { CanonicalTimelinePageProvider } from "../../domains/conversations/timeline/canonical-timeline-page-provider.js";
import { CanonicalTranscriptProjectionService } from "../../domains/conversations/timeline/canonical-transcript-projection.service.js";

export function timelineRuntime(
  store: CanonicalStore,
  secrets: SecretProvider,
  logger: ApplicationLogger,
) {
  const pages = new CanonicalTimelinePageProvider(store, secrets);
  const projections = new CanonicalTranscriptProjectionService(store);
  const dispatcher = new CanonicalProjectionDispatcher(
    projections,
    logger.child({ component: "canonical-projections" }),
  );
  dispatcher.start();
  return { pages, dispatcher };
}
