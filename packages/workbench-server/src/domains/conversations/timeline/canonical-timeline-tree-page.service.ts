import {
  timelineTreePageRequestSchema,
  timelineTreePageSchema,
  type TimelineViewOutcome,
} from "@nervekit/contracts/conversations";
import { SignedTimelineCursorCodec } from "@nervekit/protocol";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

export class CanonicalTimelineTreePageService {
  private readonly cursors: SignedTimelineCursorCodec;

  constructor(
    private readonly store: CanonicalStore,
    cursorSecret: Uint8Array,
  ) {
    this.cursors = new SignedTimelineCursorCodec(cursorSecret);
  }

  async page(rawRequest: unknown): Promise<TimelineViewOutcome> {
    const request = timelineTreePageRequestSchema.parse(rawRequest);
    if (request.visibilityId !== "default" || request.filterId !== "tree") {
      return {
        kind: "incompatible_view",
        expectedVersion: 1,
        actualVersion: 0,
      };
    }
    const [identity, currentHead, deletionState, projection] =
      await Promise.all([
        this.store.readTimelineStateIdentity(),
        this.store.readTimelineConversationHead(request.conversationId),
        this.store.readTimelineDeletionState(request.conversationId),
        this.store.readTimelineTranscriptProjectionStatus(
          request.conversationId,
        ),
      ]);
    if (!identity) return { kind: "restore_invalidated" };
    if (!currentHead || deletionState !== "active") {
      return { kind: "deleted_owner", ownerId: request.conversationId };
    }
    if (projection?.rebuildState === "rebuilding") {
      return {
        kind: "rebuilding",
        generation: projection.rebuildGeneration,
        appliedRevision: projection.appliedRevision,
      };
    }
    if (
      request.minimumRevision !== undefined &&
      (projection?.appliedRevision ?? 0) < request.minimumRevision
    ) {
      return {
        kind: "projection_lag",
        requestedRevision: request.minimumRevision,
        appliedRevision: projection?.appliedRevision ?? 0,
        canonicalRevision: currentHead.revision,
      };
    }
    const decoded = request.cursor
      ? await this.cursors.decode(request.cursor)
      : undefined;
    if (request.cursor && !decoded) return { kind: "expired_cursor" };
    if (
      decoded &&
      decoded.view.executionIncarnationId !== identity.executionIncarnationId
    ) {
      return { kind: "restore_invalidated" };
    }
    if (
      decoded &&
      projection &&
      (decoded.view.projection.schemaVersion !== projection.schemaVersion ||
        decoded.view.projection.policyVersion !== projection.policyVersion ||
        decoded.view.projection.rebuildGeneration !==
          projection.rebuildGeneration)
    ) {
      return {
        kind: "reconciliation_required",
        reason: "projection_rebuilt",
        freshViewAvailable: true,
      };
    }
    if (
      decoded &&
      (decoded.view.ordering !== "tree_commit_order" ||
        decoded.view.conversationId !== request.conversationId ||
        decoded.view.visibilityId !== request.visibilityId ||
        decoded.view.filterId !== request.filterId ||
        (request.sourceRevision !== undefined &&
          request.sourceRevision !== decoded.view.sourceRevision))
    ) {
      return {
        kind: "reconciliation_required",
        reason: "filter_changed",
        freshViewAvailable: true,
      };
    }
    const sourceRevision = decoded
      ? decoded.view.sourceRevision
      : (request.sourceRevision ?? currentHead.revision);
    if (sourceRevision > currentHead.revision) {
      return {
        kind: "reconciliation_required",
        reason: "snapshot_unavailable",
        freshViewAvailable: true,
      };
    }
    const sourceHead = await this.store.readTimelineHeadAtRevision(
      request.conversationId,
      sourceRevision,
    );
    if (!sourceHead) {
      return {
        kind: "reconciliation_required",
        reason: "snapshot_unavailable",
        freshViewAvailable: true,
      };
    }
    const view =
      decoded?.view ??
      ({
        conversationId: request.conversationId,
        sourceHeadEntryId: sourceHead.activeEntryId,
        sourceRevision,
        projection: {
          canonicalRevision: currentHead.revision,
          appliedRevision: Math.min(
            projection?.appliedRevision ?? sourceRevision,
            sourceRevision,
          ),
          schemaVersion: projection?.schemaVersion ?? 1,
          policyVersion: projection?.policyVersion ?? 1,
          rebuildGeneration: projection?.rebuildGeneration ?? 1,
        },
        visibilityId: request.visibilityId,
        filterId: request.filterId,
        ordering: "tree_commit_order" as const,
        executionIncarnationId: identity.executionIncarnationId,
      } as const);
    let after:
      | { revision: number; ordinal: number; entryId: string }
      | undefined;
    if (decoded) {
      try {
        after = decodeTreeKey(decoded.lastDisplayOrderKey);
      } catch {
        return { kind: "expired_cursor" };
      }
    }
    const slice = await this.store.readTimelineFixedTreePage(
      request.conversationId,
      sourceRevision,
      after,
      request.pageSize,
    );
    const nextCursor = slice.nextAfter
      ? await this.cursors.encode({
          version: 1,
          view,
          lastDisplayOrderKey: encodeTreeKey(slice.nextAfter),
        })
      : undefined;
    return {
      kind: "page",
      page: timelineTreePageSchema.parse({
        view,
        entries: slice.entries,
        ...(nextCursor ? { nextCursor } : {}),
        currentHead,
      }),
    };
  }
}

function encodeTreeKey(key: {
  revision: number;
  ordinal: number;
  entryId: string;
}): string {
  return `tree:${key.revision}:${key.ordinal}:${key.entryId}`;
}

function decodeTreeKey(value: string): {
  revision: number;
  ordinal: number;
  entryId: string;
} {
  const match = /^tree:(\d+):(\d+):(entry_.+)$/.exec(value);
  if (!match) throw new Error("Timeline tree cursor key is invalid.");
  const revision = Number(match[1]);
  const ordinal = Number(match[2]);
  if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(ordinal)) {
    throw new Error("Timeline tree cursor position is invalid.");
  }
  return { revision, ordinal, entryId: match[3]! };
}
