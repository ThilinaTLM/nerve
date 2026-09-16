import { createHash, randomUUID } from "node:crypto";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "../conversations/timeline/canonical-timeline-identity.service.js";

/** Establishes the first execution incarnation for an empty canonical home. */
export class CanonicalFreshHomeAdmissionService {
  constructor(private readonly store: CanonicalStore) {}

  async admit(now = new Date().toISOString()): Promise<void> {
    const current = await this.store.readTimelineRuntimeAdmission();
    if (current?.dispatchState === "admitted") return;
    if ((await this.store.migration.countLegacyRuntimeAuthority()) !== 0) {
      throw new Error(
        "A home with legacy authority must use verified migration.",
      );
    }
    const identity = await new CanonicalTimelineIdentityService(
      this.store,
    ).resolve();
    await this.store.disableTimelineRuntimeAdmission(now);
    const proofDigest = `sha256:${createHash("sha256")
      .update("canonical-empty-home-v1")
      .digest("hex")}`;
    await this.store.promoteTimelineRuntimeAdmission({
      schemaVersion: 1,
      promotionId: `promotion_${randomUUID()}`,
      namespaceId: identity.namespaceId,
      priorExecutionIncarnationId: identity.executionIncarnationId,
      executionIncarnationId: `incarnation_${randomUUID()}`,
      proofDigest,
      oldRuntimeIsolated: true,
      state: "promoted",
      promotedAt: now,
    });
  }
}
