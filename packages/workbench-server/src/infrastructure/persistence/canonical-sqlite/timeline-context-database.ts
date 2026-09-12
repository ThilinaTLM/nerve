import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ContextBoundary } from "@nervekit/contracts/conversations";
import { encode } from "./payload-codecs.js";
import { assertTimelineArtifactFinalized } from "./timeline-artifact-database.js";

export function insertTimelineContextBoundary(
  database: DatabaseSync,
  boundary: ContextBoundary,
  now: string,
): void {
  const transition = database
    .prepare(
      `SELECT kind, revision FROM conversation_transitions
       WHERE transition_id = ? AND conversation_id = ?`,
    )
    .get(boundary.transitionId, boundary.conversationId) as
    | { kind: string; revision: number }
    | undefined;
  if (transition?.kind !== "context_boundary_committed") {
    throw new Error("Context boundary requires its canonical transition.");
  }
  const head = database
    .prepare(
      `SELECT active_entry_id, revision FROM conversations
       WHERE conversation_id = ?`,
    )
    .get(boundary.conversationId) as
    | { active_entry_id: string | null; revision: number }
    | undefined;
  if (
    !head ||
    head.revision !== transition.revision ||
    !entryIsAncestor(
      database,
      boundary.conversationId,
      boundary.anchorEntryId,
      head.active_entry_id,
    ) ||
    !entryIsAncestor(
      database,
      boundary.conversationId,
      boundary.anchorEntryId,
      boundary.sourceTipEntryId,
    ) ||
    (boundary.visibleSummaryEntryId
      ? head.active_entry_id !== boundary.visibleSummaryEntryId
      : head.active_entry_id !== boundary.sourceTipEntryId)
  ) {
    throw new Error(
      "Context boundary source must belong to selected ancestry.",
    );
  }
  if (boundary.visibleSummaryEntryId) {
    const visible = database
      .prepare(
        `SELECT kind, parent_entry_id FROM conversation_entries
         WHERE entry_id = ? AND conversation_id = ? AND transition_id = ?`,
      )
      .get(
        boundary.visibleSummaryEntryId,
        boundary.conversationId,
        boundary.transitionId,
      ) as { kind: string; parent_entry_id: string | null } | undefined;
    if (
      visible?.kind !== "summary" ||
      visible.parent_entry_id !== boundary.sourceTipEntryId
    ) {
      throw new Error(
        "Visible summary entry must extend the source tip in the boundary transition.",
      );
    }
  }
  assertTimelineArtifactFinalized(
    database,
    boundary.sourceManifest.entriesManifest,
  );
  if (boundary.sourceManifest.transitiveBoundariesManifest) {
    assertTimelineArtifactFinalized(
      database,
      boundary.sourceManifest.transitiveBoundariesManifest,
    );
  }
  const sourceCounts = countContextSourceProvenance(
    database,
    boundary.conversationId,
    boundary.sourceTipEntryId,
  );
  if (
    sourceCounts.entryCount !== boundary.sourceManifest.entryCount ||
    sourceCounts.transitiveBoundaryCount !==
      boundary.sourceManifest.transitiveBoundaryCount
  ) {
    throw new Error(
      "Context source manifest does not completely cover canonical ancestry.",
    );
  }
  const manifestId = `manifest_context_${boundary.boundaryId}`;
  const manifestData = encode(boundary.sourceManifest);
  const manifestDigest = `sha256:${createHash("sha256")
    .update(manifestData)
    .digest("hex")}`;
  database
    .prepare(
      `INSERT INTO artifact_manifests (
         manifest_id, schema_version, digest, byte_length, data, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)`,
    )
    .run(
      manifestId,
      manifestDigest,
      manifestData.byteLength,
      manifestData,
      Date.parse(now),
    );
  database
    .prepare(
      `INSERT INTO context_boundaries (
         boundary_id, conversation_id, transition_id, anchor_entry_id,
         source_tip_entry_id, source_manifest_id, policy_version,
         provider_adapter_version, recipe_version, visible_summary_entry_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      boundary.boundaryId,
      boundary.conversationId,
      boundary.transitionId,
      boundary.anchorEntryId,
      boundary.sourceTipEntryId,
      manifestId,
      boundary.policyVersion,
      boundary.providerAdapterVersion,
      boundary.recipeVersion,
      boundary.visibleSummaryEntryId ?? null,
    );
}

function countContextSourceProvenance(
  database: DatabaseSync,
  conversationId: string,
  sourceTipEntryId: string | null,
): { entryCount: number; transitiveBoundaryCount: number } {
  if (sourceTipEntryId === null) {
    return { entryCount: 0, transitiveBoundaryCount: 0 };
  }
  const row = database
    .prepare(
      `WITH RECURSIVE ancestry(entry_id, parent_entry_id) AS (
         SELECT entry_id, parent_entry_id FROM conversation_entries
          WHERE conversation_id = ? AND entry_id = ?
         UNION ALL
         SELECT parent.entry_id, parent.parent_entry_id
           FROM conversation_entries parent
           JOIN ancestry child ON parent.entry_id = child.parent_entry_id
          WHERE parent.conversation_id = ?
       )
       SELECT COUNT(DISTINCT ancestry.entry_id) AS entry_count,
              COUNT(DISTINCT boundaries.boundary_id) AS boundary_count
       FROM ancestry
       LEFT JOIN context_boundaries boundaries
         ON boundaries.conversation_id = ?
        AND boundaries.visible_summary_entry_id = ancestry.entry_id`,
    )
    .get(conversationId, sourceTipEntryId, conversationId, conversationId) as {
    entry_count: number;
    boundary_count: number;
  };
  return {
    entryCount: row.entry_count,
    transitiveBoundaryCount: row.boundary_count,
  };
}

function entryIsAncestor(
  database: DatabaseSync,
  conversationId: string,
  ancestorEntryId: string | null,
  descendantEntryId: string | null,
): boolean {
  if (ancestorEntryId === null) return true;
  if (descendantEntryId === null) return false;
  const row = database
    .prepare(
      `WITH RECURSIVE ancestry(entry_id, parent_entry_id) AS (
         SELECT entry_id, parent_entry_id FROM conversation_entries
          WHERE conversation_id = ? AND entry_id = ?
         UNION ALL
         SELECT parent.entry_id, parent.parent_entry_id
           FROM conversation_entries parent
           JOIN ancestry child ON parent.entry_id = child.parent_entry_id
          WHERE parent.conversation_id = ?
       ) SELECT 1 AS present FROM ancestry WHERE entry_id = ? LIMIT 1`,
    )
    .get(conversationId, descendantEntryId, conversationId, ancestorEntryId) as
    | { present?: number }
    | undefined;
  return row?.present === 1;
}
