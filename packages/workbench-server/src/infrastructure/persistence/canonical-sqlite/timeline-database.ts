import * as legacyAuthority from "../../migrations/unified-timeline/legacy-authority-retirement-database.js";
import type {
  CanonicalAncestrySegment,
  CanonicalConversationEntry,
  ConversationHead,
  ConversationTransition,
  MutationOutcome,
  TimelineStateIdentity,
} from "@nervekit/contracts/conversations";
import type { RunControl } from "@nervekit/contracts/runs";
import {
  policyDiagnosticSchema,
  policyDocumentObservationSchema,
  policyFallbackDecisionSchema,
  policySaveIntentSchema,
} from "@nervekit/contracts/permissions";
import { deletionIntentSchema } from "@nervekit/contracts/storage";
import {
  canonicalCheckpointSchema,
  canonicalExecutionAttemptSchema,
  exactCallAuthorizationSchema,
  executionClaimSchema,
  immutableExecutionSnapshotSchema,
  logicalEffectSchema,
  providerPhaseSchema,
  recoveryActionSchema,
  runControlSchema,
  waitGroupSchema,
} from "@nervekit/contracts/runs";
import {
  artifactReferenceSchema,
  contextBoundarySchema,
  conversationTransitionSchema,
  mutationOutcomeSchema,
  timelineStateIdentitySchema,
} from "@nervekit/contracts/conversations";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateTransitionHeadChange } from "../../../domains/conversations/timeline/transition-validation.js";
import { appendDurableEventInTransaction } from "./canonical-database-helpers.js";
import { decode, encode } from "./payload-codecs.js";
import { persistTimelineDomainDocument } from "./timeline-domain-document-database.js";
import {
  assertSelectedEntry,
  validateForegroundOwnership,
} from "./timeline-head-validation.js";
import { insertTimelineFinalizedArtifact } from "./timeline-artifact-database.js";
import { assertTimelineCommandBudgets } from "./timeline-command-budget.js";
import {
  insertTimelineArtifactManifest,
  insertTimelineCheckpoint,
  insertTimelineExecutionSnapshot,
} from "./timeline-checkpoint-database.js";
import { insertTimelineContextBoundary } from "./timeline-context-database.js";
import { persistTimelineDeletionIntent } from "./timeline-deletion-database.js";
import {
  insertTimelineAuthorization,
  insertTimelineLogicalEffect,
  insertTimelineRecoveryAction,
  persistTimelineExecutionAttempt,
  persistTimelineExecutionClaim,
  validateTimelineAttemptClaims,
} from "./timeline-effect-database.js";
import {
  persistTimelineProviderPhase,
  upsertTimelineRunControl,
} from "./timeline-execution-database.js";
import {
  insertTimelinePolicyFallbackDecision,
  insertTimelinePolicyObservation,
  persistTimelinePolicyDiagnostic,
  persistTimelinePolicySaveIntent,
} from "./timeline-policy-database.js";
import { withTimelineImmediateTransaction } from "./timeline-transaction.js";
import { promoteTimelineRuntimeAdmission } from "./timeline-authority-promotion-database.js";
import { persistTimelineWaitGroup } from "./timeline-wait-group-database.js";
import { markTimelineTranscriptProjectionPending } from "./timeline-projection-database.js";
import { persistCanonicalLifecycleWork } from "./timeline-lifecycle-work-database.js";
import {
  readTimelineAncestrySegment,
  readTimelineCommandReceipt,
  readTimelineDeletionState,
  readTimelineFixedAncestryPage,
  readTimelineFixedTreePage,
  readTimelineHeadAtRevision,
  readTimelineRunControl,
  readTimelineRuntimeAdmission,
  type TimelineTreePageKey,
  readTimelineStateIdentity,
  timelineEntryIsAncestor,
} from "./timeline-query-database.js";

import type { CommitConversationCommandInput } from "./timeline-command-contracts.js";
import type { HeadRow, ReceiptRow } from "./timeline-row-types.js";
import { ensureTimelineStateIdentity } from "./timeline-identity-database.js";
export type {
  CommitConversationCommandInput,
  TimelineExpectedHead,
  TimelineExpectedRunFence,
  TimelinePublicationIntent,
} from "./timeline-command-contracts.js";

export class CanonicalTimelineDatabase {
  constructor(private readonly database: DatabaseSync) {}

  countLegacy() {
    return legacyAuthority.countLegacyRuntimeAuthority(this.database);
  }
  readLegacy() {
    return legacyAuthority.readLegacyLifecycleAuthorityFacts(this.database);
  }
  retireLegacy() {
    return legacyAuthority.retireLegacyRuntimeAuthority(this.database);
  }

  commit(input: CommitConversationCommandInput): MutationOutcome {
    return commitConversationCommandInTransaction(this.database, input);
  }

  readCommandReceipt(
    input: Parameters<typeof readTimelineCommandReceipt>[1],
  ): MutationOutcome | undefined {
    return readTimelineCommandReceipt(this.database, input);
  }

  readStateIdentity(): TimelineStateIdentity | undefined {
    return readTimelineStateIdentity(this.database);
  }

  readRuntimeAdmission() {
    return readTimelineRuntimeAdmission(this.database);
  }

  promoteRuntimeAdmission(
    promotion: Parameters<typeof promoteTimelineRuntimeAdmission>[1],
  ) {
    return promoteTimelineRuntimeAdmission(this.database, promotion);
  }

  disableRuntimeAdmission(now: string) {
    return withTimelineImmediateTransaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE runtime_admission
           SET dispatch_state = 'disabled', updated_at_ms = ?
           WHERE singleton = 1`,
        )
        .run(Date.parse(now));
      if (result.changes !== 1) {
        throw new Error("Canonical runtime admission is not initialized.");
      }
      return readTimelineRuntimeAdmission(this.database);
    });
  }

  readDeletionState(conversationId: string) {
    return readTimelineDeletionState(this.database, conversationId);
  }

  readHeadAtRevision(
    conversationId: string,
    revision: number,
  ): ConversationHead | undefined {
    return readTimelineHeadAtRevision(this.database, conversationId, revision);
  }

  readHead(conversationId: string): ConversationHead | undefined {
    return readTimelineConversationHead(this.database, conversationId);
  }

  readRunControl(
    conversationId: string,
    runId: string,
  ): RunControl | undefined {
    return readTimelineRunControl(this.database, conversationId, runId);
  }

  readFixedTreePage(input: {
    conversationId: string;
    sourceRevision: number;
    after?: TimelineTreePageKey;
    limit: number;
  }) {
    return readTimelineFixedTreePage(this.database, input);
  }

  readFixedAncestryPage(input: {
    conversationId: string;
    sourceEntryId: string;
    beforeDepth?: number;
    limit: number;
  }) {
    return readTimelineFixedAncestryPage(this.database, input);
  }

  readAncestrySegment(input: {
    conversationId: string;
    sourceEntryId: string;
    limit: number;
  }): CanonicalAncestrySegment {
    return readTimelineAncestrySegment(this.database, input);
  }

  isAncestor(
    conversationId: string,
    ancestorEntryId: string | null,
    descendantEntryId: string | null,
  ): boolean {
    return timelineEntryIsAncestor(
      this.database,
      conversationId,
      ancestorEntryId,
      descendantEntryId,
    );
  }
}

export function readTimelineConversationHead(
  database: DatabaseSync,
  conversationId: string,
): ConversationHead | undefined {
  const row = database
    .prepare(
      `SELECT revision, active_entry_id, selection_epoch, foreground_run_id
       FROM conversations WHERE conversation_id = ?`,
    )
    .get(conversationId) as
    | {
        revision: number;
        active_entry_id: string | null;
        selection_epoch: number;
        foreground_run_id: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    schemaVersion: 1,
    conversationId,
    revision: row.revision,
    activeEntryId: row.active_entry_id,
    selectionEpoch: row.selection_epoch,
    foregroundRunId: row.foreground_run_id,
  };
}

export function commitConversationCommandInTransaction(
  database: DatabaseSync,
  input: CommitConversationCommandInput,
): MutationOutcome {
  timelineStateIdentitySchema.parse({
    schemaVersion: 1,
    namespaceId: input.namespaceId,
    executionIncarnationId: input.executionIncarnationId,
    formatVersion: 1,
    promotedAt: input.now,
  });
  if (input.commandId.length < 1 || input.commandId.length > 256) {
    throw new Error("Command identity is invalid.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.fingerprint)) {
    throw new Error("Command fingerprint is invalid.");
  }
  assertTimelineCommandBudgets(input);
  return withTimelineImmediateTransaction(database, () => {
    const receipt = database
      .prepare(
        `SELECT fingerprint_hash, outcome_json FROM command_receipts
         WHERE namespace_id = ? AND operation_kind = ? AND owner_kind = ?
           AND owner_id = ? AND command_id = ?`,
      )
      .get(
        input.namespaceId,
        input.operationKind,
        input.ownerKind,
        input.ownerId,
        input.commandId,
      ) as ReceiptRow | undefined;
    if (receipt) {
      if (receipt.fingerprint_hash !== input.fingerprint) {
        return {
          kind: "fingerprint_mismatch",
          commandId: input.commandId,
          retry: "never_with_same_command_id",
        };
      }
      const original = mutationOutcomeSchema.parse(
        decode(receipt.outcome_json),
      );
      return original.kind === "committed"
        ? { ...original, kind: "receipt_replay" }
        : original;
    }

    ensureTimelineStateIdentity(database, input);
    const expectedByConversation = new Map(
      input.expectedHeads.map((expected) => [
        expected.conversationId,
        expected,
      ]),
    );
    const initialHeads = new Map<string, ConversationHead | undefined>();
    if (expectedByConversation.size !== input.expectedHeads.length) {
      throw new Error("Expected conversation heads must be unique.");
    }

    const conflicts: Array<{ conversationId: string; revision: number }> = [];
    const conversationsToCreate: string[] = [];
    for (const expected of input.expectedHeads) {
      let current = database
        .prepare(
          `SELECT revision, selection_epoch, deletion_state FROM conversations
           WHERE conversation_id = ?`,
        )
        .get(expected.conversationId) as HeadRow | undefined;
      initialHeads.set(
        expected.conversationId,
        readTimelineConversationHead(database, expected.conversationId),
      );
      if (!current && expected.createIfMissing) {
        if (expected.revision !== 0 || expected.selectionEpoch !== 0) {
          conflicts.push({
            conversationId: expected.conversationId,
            revision: 0,
          });
          continue;
        }
        conversationsToCreate.push(expected.conversationId);
        current = { revision: 0, selection_epoch: 0, deletion_state: "active" };
      }
      if (current?.deletion_state !== "active") {
        return {
          kind: "deleted_owner",
          ownerId: expected.conversationId,
        };
      }
      if (
        !current ||
        current.revision !== expected.revision ||
        current.selection_epoch !== expected.selectionEpoch
      ) {
        conflicts.push({
          conversationId: expected.conversationId,
          revision: current?.revision ?? 0,
        });
      }
    }
    if (conflicts.length > 0) {
      return {
        kind: "cas_conflict",
        current: conflicts,
        retry: "reload_and_revalidate",
      };
    }
    for (const expected of input.expectedRunFences ?? []) {
      const current = database
        .prepare(
          `SELECT generation, bound_selection_epoch, continuation_entry_id,
                  foreground_owned, revision
           FROM run_controls
           WHERE conversation_id = ? AND run_id = ?`,
        )
        .get(expected.conversationId, expected.runId) as
        | {
            generation: number;
            bound_selection_epoch: number;
            continuation_entry_id: string | null;
            foreground_owned: number;
            revision: number;
          }
        | undefined;
      if (
        !current ||
        current.generation !== expected.generation ||
        current.revision !== expected.revision ||
        current.bound_selection_epoch !== expected.selectionEpoch ||
        current.continuation_entry_id !== expected.continuationEntryId ||
        (expected.requireForegroundOwnership && current.foreground_owned !== 1)
      ) {
        return {
          kind: "superseded",
          reason: "run_fence_changed",
          position: readTimelineConversationHead(
            database,
            expected.conversationId,
          ),
        };
      }
    }
    const nowMs = Date.parse(input.now);
    const insertConversation = database.prepare(
      `INSERT INTO conversations (
         conversation_id, revision, active_entry_id, selection_epoch,
         foreground_run_id, deletion_state, created_at_ms, updated_at_ms
       ) VALUES (?, 0, NULL, 0, NULL, 'active', ?, ?)`,
    );
    for (const conversationId of conversationsToCreate) {
      insertConversation.run(conversationId, nowMs, nowMs);
    }

    for (const document of input.domainDocuments ?? []) {
      if (!persistTimelineDomainDocument(database, document, nowMs)) {
        return {
          kind: "cas_conflict",
          current: input.expectedHeads.map((head) => ({
            conversationId: head.conversationId,
            revision: head.revision,
          })),
          retry: "reload_and_revalidate",
        };
      }
    }

    const ordered = [...input.transitions].sort(
      (left, right) =>
        left.conversationId.localeCompare(right.conversationId) ||
        left.revision - right.revision,
    );
    const currentRevision = new Map(
      input.expectedHeads.map((head) => [head.conversationId, head.revision]),
    );
    for (const transition of ordered) {
      const parsed = conversationTransitionSchema.parse(transition);
      const expected = expectedByConversation.get(parsed.conversationId);
      if (!expected) {
        throw new Error(
          `Transition ${parsed.transitionId} has no expected conversation head.`,
        );
      }
      const previousRevision = currentRevision.get(parsed.conversationId)!;
      if (parsed.revision !== previousRevision + 1) {
        throw new Error(
          `Transition ${parsed.transitionId} is not the next conversation revision.`,
        );
      }
      const currentHead = readTimelineConversationHead(
        database,
        parsed.conversationId,
      );
      if (!currentHead) {
        throw new Error(
          `Conversation ${parsed.conversationId} does not exist.`,
        );
      }
      validateTransitionHeadChange(currentHead, parsed);
      insertTransition(database, parsed);
      currentRevision.set(parsed.conversationId, parsed.revision);
    }
    for (const conversationId of new Set(
      ordered.map((item) => item.conversationId),
    ))
      markTimelineTranscriptProjectionPending(
        database,
        conversationId,
        input.now,
      );

    for (const artifact of input.finalizedArtifacts ?? []) {
      insertTimelineFinalizedArtifact(
        database,
        artifactReferenceSchema.parse(artifact),
      );
    }
    for (const manifest of input.artifactManifests ?? []) {
      insertTimelineArtifactManifest(database, manifest, input.now);
    }
    for (const boundary of input.contextBoundaries ?? []) {
      insertTimelineContextBoundary(
        database,
        contextBoundarySchema.parse(boundary),
        input.now,
      );
    }
    for (const control of input.runControls ?? []) {
      upsertTimelineRunControl(
        database,
        runControlSchema.parse(control),
        input.now,
      );
    }
    for (const snapshot of input.executionSnapshots ?? []) {
      insertTimelineExecutionSnapshot(
        database,
        immutableExecutionSnapshotSchema.parse(snapshot),
      );
    }
    for (const group of input.waitGroups ?? []) {
      persistTimelineWaitGroup(
        database,
        waitGroupSchema.parse(group),
        input.now,
      );
    }
    for (const checkpoint of input.checkpoints ?? []) {
      insertTimelineCheckpoint(
        database,
        canonicalCheckpointSchema.parse(checkpoint),
      );
    }
    for (const deletionIntent of input.deletionIntents ?? []) {
      persistTimelineDeletionIntent(
        database,
        deletionIntentSchema.parse(deletionIntent),
      );
    }
    for (const observation of input.policyObservations ?? []) {
      insertTimelinePolicyObservation(
        database,
        policyDocumentObservationSchema.parse(observation),
      );
    }
    for (const diagnostic of input.policyDiagnostics ?? []) {
      persistTimelinePolicyDiagnostic(
        database,
        policyDiagnosticSchema.parse(diagnostic),
      );
    }
    for (const decision of input.policyFallbackDecisions ?? []) {
      insertTimelinePolicyFallbackDecision(
        database,
        policyFallbackDecisionSchema.parse(decision),
      );
    }
    for (const saveIntent of input.policySaveIntents ?? []) {
      persistTimelinePolicySaveIntent(
        database,
        policySaveIntentSchema.parse(saveIntent),
      );
    }
    for (const authorization of input.authorizations ?? []) {
      insertTimelineAuthorization(
        database,
        exactCallAuthorizationSchema.parse(authorization),
      );
    }
    for (const effect of input.logicalEffects ?? []) {
      insertTimelineLogicalEffect(database, logicalEffectSchema.parse(effect));
    }
    for (const phase of input.providerPhases ?? []) {
      persistTimelineProviderPhase(
        database,
        providerPhaseSchema.parse(phase),
        input.now,
      );
    }
    for (const attempt of input.executionAttempts ?? []) {
      persistTimelineExecutionAttempt(
        database,
        canonicalExecutionAttemptSchema.parse(attempt),
      );
    }
    for (const claim of input.executionClaims ?? []) {
      persistTimelineExecutionClaim(
        database,
        executionClaimSchema.parse(claim),
        input.now,
      );
    }
    validateTimelineAttemptClaims(database, [
      ...(input.executionAttempts ?? []).map((attempt) => attempt.attemptId),
      ...(input.executionClaims ?? []).map((claim) => claim.attemptId),
    ]);
    for (const work of input.lifecycleWorks ?? []) {
      persistCanonicalLifecycleWork(database, work);
    }
    for (const action of input.recoveryActions ?? []) {
      insertTimelineRecoveryAction(
        database,
        recoveryActionSchema.parse(action),
      );
    }
    for (const expected of input.expectedHeads) {
      validateForegroundOwnership(
        database,
        initialHeads.get(expected.conversationId),
        readTimelineConversationHead(database, expected.conversationId),
      );
    }

    const positions = ordered.map((transition) => ({
      conversationId: transition.conversationId,
      revision: transition.revision,
      transitionId: transition.transitionId,
    }));
    const committed: MutationOutcome = {
      kind: "committed",
      positions,
      value: input.outcome,
    };
    database
      .prepare(
        `INSERT INTO command_receipts (
           namespace_id, operation_kind, owner_kind, owner_id, command_id,
           fingerprint_version, fingerprint_hash, outcome_version,
           outcome_json, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.namespaceId,
        input.operationKind,
        input.ownerKind,
        input.ownerId,
        input.commandId,
        input.fingerprintVersion,
        input.fingerprint,
        encode(committed),
        Date.parse(input.now),
      );

    for (const intent of input.publicationIntents) {
      appendDurableEventInTransaction(database, {
        stream: intent.stream,
        intentId: intent.intentId,
        eventType: intent.eventType,
        data: intent.data,
        occurredAt: intent.occurredAt,
        conversationId: intent.conversationId,
      });
    }
    return committed;
  });
}

function insertTransition(
  database: DatabaseSync,
  transition: ConversationTransition,
): void {
  database
    .prepare(
      `INSERT INTO conversation_transitions (
         transition_id, conversation_id, revision, schema_version, kind,
         command_id, input_fingerprint, actor_json, cause_json,
         committed_at_ms, resulting_control_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      transition.transitionId,
      transition.conversationId,
      transition.revision,
      transition.schemaVersion,
      transition.kind,
      transition.commandId,
      transition.inputFingerprint,
      encode(transition.actor),
      encode(transition.cause),
      Date.parse(transition.committedAt),
      encode(transition.resultingHead),
    );
  for (const entry of [...transition.entries].sort(
    (left, right) => left.ordinal - right.ordinal,
  )) {
    insertEntry(database, entry);
  }
  assertSelectedEntry(database, transition.resultingHead);
  database
    .prepare(
      `UPDATE conversations SET
         revision = ?, active_entry_id = ?, selection_epoch = ?,
         foreground_run_id = ?, updated_at_ms = ?
       WHERE conversation_id = ?`,
    )
    .run(
      transition.resultingHead.revision,
      transition.resultingHead.activeEntryId,
      transition.resultingHead.selectionEpoch,
      transition.resultingHead.foregroundRunId,
      Date.parse(transition.committedAt),
      transition.conversationId,
    );
}

function insertEntry(
  database: DatabaseSync,
  entry: CanonicalConversationEntry,
): void {
  let ancestryDepth = 0;
  if (entry.parentEntryId) {
    const parent = database
      .prepare(
        `SELECT conversation_id, ancestry_depth
         FROM conversation_entries WHERE entry_id = ?`,
      )
      .get(entry.parentEntryId) as
      | { conversation_id: string; ancestry_depth: number }
      | undefined;
    if (!parent || parent.conversation_id !== entry.conversationId) {
      throw new Error(`Entry ${entry.entryId} has an invalid parent.`);
    }
    ancestryDepth = parent.ancestry_depth + 1;
  }
  const artifactManifestId = persistEntryArtifactManifest(database, entry);
  database
    .prepare(
      `INSERT INTO conversation_entries (
         entry_id, conversation_id, transition_id, ordinal, parent_entry_id,
         ancestry_depth, kind, inline_content_json, artifact_manifest_id,
         run_id, tool_call_id, interaction_id, provenance_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.entryId,
      entry.conversationId,
      entry.transitionId,
      entry.ordinal,
      entry.parentEntryId,
      ancestryDepth,
      entry.kind,
      entry.inlineContent === undefined ? null : encode(entry.inlineContent),
      artifactManifestId,
      entry.runId ?? null,
      entry.toolCallId ?? null,
      entry.interactionId ?? null,
      encode(entry.provenance),
    );
  insertAncestorJumps(database, entry.entryId, entry.parentEntryId);
}

function insertAncestorJumps(
  database: DatabaseSync,
  entryId: string,
  parentEntryId: string | null,
): void {
  if (!parentEntryId) return;
  const insert = database.prepare(
    `INSERT INTO entry_ancestor_jumps (entry_id, power, ancestor_entry_id)
     VALUES (?, ?, ?)`,
  );
  insert.run(entryId, 0, parentEntryId);
  let ancestorId = parentEntryId;
  for (let power = 1; power < 63; power += 1) {
    const row = database
      .prepare(
        `SELECT ancestor_entry_id FROM entry_ancestor_jumps
         WHERE entry_id = ? AND power = ?`,
      )
      .get(ancestorId, power - 1) as { ancestor_entry_id: string } | undefined;
    if (!row) break;
    ancestorId = row.ancestor_entry_id;
    insert.run(entryId, power, ancestorId);
  }
}

function persistEntryArtifactManifest(
  database: DatabaseSync,
  entry: CanonicalConversationEntry,
): string | null {
  if (entry.artifacts.length === 0) return null;
  const data = encode({ version: 1, artifacts: entry.artifacts });
  const manifestId = `manifest_entry_${entry.entryId}`;
  const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  database
    .prepare(
      `INSERT INTO artifact_manifests (
         manifest_id, schema_version, digest, byte_length, data, created_at_ms
       ) VALUES (?, 1, ?, ?, ?, ?)`,
    )
    .run(manifestId, digest, data.byteLength, data, Date.now());
  return manifestId;
}
