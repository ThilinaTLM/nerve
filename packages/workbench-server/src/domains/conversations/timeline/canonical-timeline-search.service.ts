import { createHash } from "node:crypto";
import {
  timelinePageSchema,
  timelineSearchRequestSchema,
  type TimelineViewOutcome,
} from "@nervekit/contracts/conversations";
import { SignedTimelineCursorCodec } from "@nervekit/protocol";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

/** Serves fixed-view full-text search pages from the rebuildable projection. */
export class CanonicalTimelineSearchService {
  private readonly cursors: SignedTimelineCursorCodec;

  constructor(
    private readonly store: CanonicalStore,
    cursorSecret: Uint8Array,
  ) {
    this.cursors = new SignedTimelineCursorCodec(cursorSecret);
  }

  async search(rawRequest: unknown): Promise<TimelineViewOutcome> {
    const request = timelineSearchRequestSchema.parse(rawRequest);
    const queryId = digestQuery(request.query);
    const filterId = `search:${queryId}`;
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
      (!projection ||
        decoded.view.projection.schemaVersion !== projection.schemaVersion ||
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
      (decoded.view.conversationId !== request.conversationId ||
        decoded.view.visibilityId !== request.visibilityId ||
        decoded.view.filterId !== filterId ||
        decoded.view.ordering !== "search_ancestry")
    ) {
      return {
        kind: "reconciliation_required",
        reason: "filter_changed",
        freshViewAvailable: true,
      };
    }

    const sourceRevision = decoded?.view.sourceRevision ?? currentHead.revision;
    if (
      !projection ||
      projection.rebuildState !== "ready" ||
      projection.appliedRevision < sourceRevision
    ) {
      return {
        kind: "projection_lag",
        requestedRevision: sourceRevision,
        appliedRevision: projection?.appliedRevision ?? 0,
        canonicalRevision: currentHead.revision,
      };
    }
    const view =
      decoded?.view ??
      ({
        conversationId: request.conversationId,
        sourceHeadEntryId: currentHead.activeEntryId,
        sourceRevision,
        projection: {
          canonicalRevision: sourceRevision,
          appliedRevision: sourceRevision,
          schemaVersion: projection.schemaVersion,
          policyVersion: projection.policyVersion,
          rebuildGeneration: projection.rebuildGeneration,
        },
        visibilityId: request.visibilityId,
        filterId,
        ordering: "search_ancestry" as const,
        executionIncarnationId: identity.executionIncarnationId,
      } as const);
    const after = decoded
      ? decodeSearchPosition(decoded.lastDisplayOrderKey)
      : undefined;
    const expression = toFtsExpression(request.query);
    const slice =
      expression.length === 0
        ? { entries: [] }
        : ((await this.store.readTimelineSearchProjectionPage({
            conversationId: request.conversationId,
            sourceRevision,
            matchExpression: expression,
            ...(after
              ? { afterDepth: after.depth, afterEntryId: after.entryId }
              : {}),
            limit: request.pageSize,
          })) ?? { entries: [] });
    const nextCursor = slice.next
      ? await this.cursors.encode({
          version: 1,
          view,
          lastDisplayOrderKey: encodeSearchPosition(
            slice.next.depth,
            slice.next.entryId,
          ),
        })
      : undefined;
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

function digestQuery(query: string): string {
  return createHash("sha256")
    .update(query.normalize("NFKC").toLocaleLowerCase())
    .digest("hex");
}

function toFtsExpression(query: string): string {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.slice(0, 16);
  return (
    terms?.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ") ?? ""
  );
}

function encodeSearchPosition(depth: number, entryId: string): string {
  if (
    !Number.isSafeInteger(depth) ||
    depth < 0 ||
    !entryId.startsWith("entry_")
  ) {
    throw new Error("Search projection position is invalid.");
  }
  return `search-depth:${depth}:${entryId}`;
}

function decodeSearchPosition(value: string): {
  depth: number;
  entryId: string;
} {
  const match = /^search-depth:(\d+):(entry_.+)$/.exec(value);
  const depth = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(depth) || depth < 0) {
    throw new Error("Search cursor position is invalid.");
  }
  return { depth, entryId: match[2] };
}
