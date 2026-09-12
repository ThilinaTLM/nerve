import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

/** Owns rebuildable transcript projection state; canonical ancestry remains authority. */
export class CanonicalTranscriptProjectionService {
  constructor(private readonly store: CanonicalStore) {}

  rebuild(conversationId: string, now = new Date().toISOString()) {
    return this.store.rebuildTimelineTranscriptProjection(conversationId, now);
  }

  status(conversationId: string) {
    return this.store.readTimelineTranscriptProjectionStatus(conversationId);
  }
}
