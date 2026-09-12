import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

/** Owns rebuildable transcript projection state; canonical ancestry remains authority. */
export class CanonicalTranscriptProjectionService {
  constructor(private readonly store: CanonicalStore) {}

  rebuild(conversationId: string, now = new Date().toISOString()) {
    return this.store.rebuildTimelineTranscriptProjection(conversationId, now);
  }

  async rebuildPending(limit = 10, now = new Date().toISOString()) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError(
        "Projection rebuild batch must be between 1 and 100.",
      );
    }
    const conversationIds =
      await this.store.readPendingTimelineTranscriptProjections(limit);
    const rebuilt = [];
    for (const conversationId of conversationIds) {
      const status = await this.rebuild(conversationId, now);
      if (status) rebuilt.push(status);
    }
    return rebuilt;
  }

  status(conversationId: string) {
    return this.store.readTimelineTranscriptProjectionStatus(conversationId);
  }
}
