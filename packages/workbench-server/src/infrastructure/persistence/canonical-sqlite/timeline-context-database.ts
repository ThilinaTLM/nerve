import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ContextBoundary } from "@nervekit/contracts/conversations";
import { encode } from "./payload-codecs.js";

export function insertTimelineContextBoundary(
  database: DatabaseSync,
  boundary: ContextBoundary,
  now: string,
): void {
  const transition = database
    .prepare(
      `SELECT kind FROM conversation_transitions
       WHERE transition_id = ? AND conversation_id = ?`,
    )
    .get(boundary.transitionId, boundary.conversationId) as
    | { kind: string }
    | undefined;
  if (transition?.kind !== "context_boundary_committed") {
    throw new Error("Context boundary requires its canonical transition.");
  }
  const head = database
    .prepare(
      `SELECT active_entry_id FROM conversations WHERE conversation_id = ?`,
    )
    .get(boundary.conversationId) as
    | { active_entry_id: string | null }
    | undefined;
  if (
    !head ||
    !entryIsAncestor(
      database,
      boundary.conversationId,
      boundary.anchorEntryId,
      head.active_entry_id,
    ) ||
    !entryIsAncestor(
      database,
      boundary.conversationId,
      boundary.sourceTipEntryId,
      head.active_entry_id,
    )
  ) {
    throw new Error(
      "Context boundary source must belong to selected ancestry.",
    );
  }
  if (boundary.visibleSummaryEntryId) {
    const visible = database
      .prepare(
        `SELECT 1 AS present FROM conversation_entries
         WHERE entry_id = ? AND conversation_id = ? AND transition_id = ?`,
      )
      .get(
        boundary.visibleSummaryEntryId,
        boundary.conversationId,
        boundary.transitionId,
      ) as { present?: number } | undefined;
    if (visible?.present !== 1) {
      throw new Error(
        "Visible summary entry must belong to the boundary transition.",
      );
    }
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
