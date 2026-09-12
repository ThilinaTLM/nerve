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
    const [identity, currentHead, deletionState] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineConversationHead(request.conversationId),
      this.store.readTimelineDeletionState(request.conversationId),
    ]);
    if (!identity) return { kind: "restore_invalidated" };
    if (!currentHead || deletionState !== "active") {
      return { kind: "deleted_owner", ownerId: request.conversationId };
    }
    if (
      request.minimumRevision !== undefined &&
      currentHead.revision < request.minimumRevision
    ) {
      return {
        kind: "projection_lag",
        requestedRevision: request.minimumRevision,
        appliedRevision: currentHead.revision,
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
          canonicalRevision: sourceRevision,
          appliedRevision: sourceRevision,
          schemaVersion: 1,
          policyVersion: 1,
          rebuildGeneration: 1,
        },
        visibilityId: request.visibilityId,
        filterId: request.filterId,
        ordering: "tree_commit_order" as const,
        executionIncarnationId: identity.executionIncarnationId,
      } as const);
    const slice = await this.store.readTimelineFixedTreePage(
      request.conversationId,
      sourceRevision,
      decoded ? decodeTreeKey(decoded.lastDisplayOrderKey) : undefined,
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
