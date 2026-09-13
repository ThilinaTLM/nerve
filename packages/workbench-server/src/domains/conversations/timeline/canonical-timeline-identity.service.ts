import { randomUUID } from "node:crypto";
import type { TimelineStateIdentity } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { conversationCommandFingerprint } from "./command-fingerprint.js";
import { ConversationTransitionService } from "./conversation-transition.service.js";
import { CANONICAL_SCHEMA_VERSION } from "../../../infrastructure/persistence/canonical-sqlite/schema.js";

/** Establishes the stable namespace/restore-era incarnation before mutations. */
export class CanonicalTimelineIdentityService {
  private resolving?: Promise<TimelineStateIdentity>;

  constructor(private readonly store: CanonicalStore) {}

  resolve(): Promise<TimelineStateIdentity> {
    this.resolving ??= this.resolveOnce().finally(() => {
      this.resolving = undefined;
    });
    return this.resolving;
  }

  private async resolveOnce(): Promise<TimelineStateIdentity> {
    const current = await this.store.readTimelineStateIdentity();
    if (current) return current;
    const now = new Date().toISOString();
    const identity: TimelineStateIdentity = {
      schemaVersion: 1,
      namespaceId: `namespace_${randomUUID()}`,
      executionIncarnationId: `incarnation_${randomUUID()}`,
      formatVersion: CANONICAL_SCHEMA_VERSION,
      promotedAt: now,
    };
    const commandId = "initialize-canonical-timeline-identity";
    const fingerprint = conversationCommandFingerprint({
      operation: "initialize_canonical_timeline_identity",
      identity,
    });
    try {
      await new ConversationTransitionService(this.store).commit({
        namespaceId: identity.namespaceId,
        executionIncarnationId: identity.executionIncarnationId,
        operationKind: "initialize_canonical_timeline_identity",
        ownerKind: "state",
        ownerId: identity.namespaceId,
        commandId,
        fingerprintVersion: 1,
        fingerprint,
        expectedHeads: [],
        transitions: [],
        outcome: identity,
        publicationIntents: [],
        now,
      });
    } catch (error) {
      const winner = await this.store.readTimelineStateIdentity();
      if (winner) return winner;
      throw error;
    }
    const committed = await this.store.readTimelineStateIdentity();
    if (!committed) {
      throw new Error("Canonical timeline identity commit was not observable.");
    }
    return committed;
  }
}
