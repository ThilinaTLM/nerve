import {
  timelinePageRequestSchema,
  timelinePageSchema,
  type TimelineViewOutcome,
} from "@nervekit/contracts/conversations";
import { SignedTimelineCursorCodec } from "@nervekit/protocol";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

const PROJECTION_SCHEMA_VERSION = 1;
const PROJECTION_POLICY_VERSION = 1;
const REBUILD_GENERATION = 1;

/** Serves fixed-view pages from canonical ancestry when projection lag exists. */
export class CanonicalTimelinePageService {
  private readonly cursors: SignedTimelineCursorCodec;

  constructor(
    private readonly store: CanonicalStore,
    cursorSecret: Uint8Array,
  ) {
    this.cursors = new SignedTimelineCursorCodec(cursorSecret);
  }

  async page(rawRequest: unknown): Promise<TimelineViewOutcome> {
    const request = timelinePageRequestSchema.parse(rawRequest);
    if (
      request.visibilityId !== "default" ||
      request.filterId !== "transcript"
    ) {
      return {
        kind: "incompatible_view",
        expectedVersion: 1,
        actualVersion: 0,
      };
    }
    const [identity, currentHead] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineConversationHead(request.conversationId),
    ]);
    if (!identity) return { kind: "restore_invalidated" };
    if (!currentHead) {
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
      (decoded.view.conversationId !== request.conversationId ||
        decoded.view.visibilityId !== request.visibilityId ||
        decoded.view.filterId !== request.filterId ||
        (request.sourceHeadEntryId !== undefined &&
          request.sourceHeadEntryId !== decoded.view.sourceHeadEntryId))
    ) {
      return {
        kind: "reconciliation_required",
        reason: "filter_changed",
        freshViewAvailable: true,
      };
    }

    const sourceHeadEntryId = decoded
      ? decoded.view.sourceHeadEntryId
      : (request.sourceHeadEntryId ?? currentHead.activeEntryId);
    const sourceRevision = decoded
      ? decoded.view.sourceRevision
      : currentHead.revision;
    const view =
      decoded?.view ??
      ({
        conversationId: request.conversationId,
        sourceHeadEntryId,
        sourceRevision,
        projection: {
          canonicalRevision: sourceRevision,
          appliedRevision: sourceRevision,
          schemaVersion: PROJECTION_SCHEMA_VERSION,
          policyVersion: PROJECTION_POLICY_VERSION,
          rebuildGeneration: REBUILD_GENERATION,
        },
        visibilityId: request.visibilityId,
        filterId: request.filterId,
        ordering: "ancestry_ascending" as const,
        executionIncarnationId: identity.executionIncarnationId,
      } as const);
    const beforeDepth = decoded
      ? decodeDisplayOrderKey(decoded.lastDisplayOrderKey)
      : undefined;
    const slice = sourceHeadEntryId
      ? await this.store.readTimelineFixedAncestryPage(
          request.conversationId,
          sourceHeadEntryId,
          beforeDepth,
          request.pageSize,
        )
      : { entries: [] };
    const nextCursor =
      slice.nextBeforeDepth === undefined
        ? undefined
        : await this.cursors.encode({
            version: 1,
            view,
            lastDisplayOrderKey: encodeDisplayOrderKey(slice.nextBeforeDepth),
          });
    return {
      kind: "page",
      page: timelinePageSchema.parse({
        view,
        entries: slice.entries,
        ...(nextCursor ? { nextCursor } : {}),
        currentHead,
      }),
    };
  }
}

function encodeDisplayOrderKey(depth: number): string {
  return `depth:${depth.toString().padStart(16, "0")}`;
}

function decodeDisplayOrderKey(value: string): number {
  if (!/^depth:\d{16}$/.test(value)) {
    throw new Error("Timeline cursor display key is invalid.");
  }
  const depth = Number(value.slice("depth:".length));
  if (!Number.isSafeInteger(depth) || depth < 1) {
    throw new Error("Timeline cursor display depth is invalid.");
  }
  return depth;
}
