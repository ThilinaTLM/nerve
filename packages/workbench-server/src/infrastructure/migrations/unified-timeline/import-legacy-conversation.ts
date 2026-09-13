import { createHash } from "node:crypto";
import type {
  CanonicalConversationEntry,
  ConversationEntry,
  ConversationHead,
  ConversationTransition,
} from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../persistence/canonical-sqlite/canonical-store.js";
import { CanonicalConversationCreationService } from "../../../domains/conversations/timeline/canonical-conversation-creation.service.js";
import { CanonicalTimelineIdentityService } from "../../../domains/conversations/timeline/canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "../../../domains/conversations/timeline/conversation-transition.service.js";
import { canonicalConversationJson } from "../../../domains/conversations/timeline/command-fingerprint.js";

const IMPORT_BATCH_SIZE = 64;

export interface LegacyConversationImportSource {
  conversationId: string;
  entries: readonly ConversationEntry[];
  activeEntryId: string | null;
  sourceLocator: string;
  sourceDigest: string;
  importedAt: string;
}

/**
 * Migration-only importer. It preserves the proved legacy tree and selection
 * without exposing legacy schemas to target runtime services. Every bounded
 * batch has a deterministic receipt, so restart replays already committed work.
 */
export class LegacyConversationTimelineImporter {
  private readonly transitions: ConversationTransitionService;

  constructor(private readonly store: CanonicalStore) {
    this.transitions = new ConversationTransitionService(store);
  }

  async import(
    source: LegacyConversationImportSource,
  ): Promise<ConversationHead> {
    const entries = validateAndOrderSource(source);
    const identity = await new CanonicalTimelineIdentityService(
      this.store,
    ).resolve();
    if (entries.length === 0) {
      const result = await new CanonicalConversationCreationService(
        this.store,
      ).createEmpty({
        conversationId: source.conversationId,
        commandId: `migration-unified-timeline:${source.conversationId}:empty`,
        now: source.importedAt,
      });
      if (result.kind === "rejected") {
        throw new Error(`Empty legacy conversation import was rejected.`);
      }
      return result.head;
    }

    let head: ConversationHead = {
      schemaVersion: 1,
      conversationId: source.conversationId,
      revision: 0,
      activeEntryId: null,
      selectionEpoch: 0,
      foregroundRunId: null,
    };
    const batches = chunk(entries, IMPORT_BATCH_SIZE);
    for (const [batchIndex, batch] of batches.entries()) {
      const finalBatch = batchIndex === batches.length - 1;
      const commandId = `migration-unified-timeline:${source.conversationId}:${batchIndex}`;
      const transitionId = `transition_import_${stableHex(`${source.conversationId}:${batchIndex}`).slice(0, 32)}`;
      const transitionEntries = batch.map((entry, ordinal) => ({
        ...entry,
        transitionId,
        ordinal,
      }));
      const fingerprint = `sha256:${stableHex(
        canonicalConversationJson({
          schemaVersion: 1,
          sourceDigest: source.sourceDigest,
          conversationId: source.conversationId,
          batchIndex,
          entries: transitionEntries,
          activeEntryId: finalBatch
            ? source.activeEntryId
            : batch.at(-1)!.entryId,
        }),
      )}`;
      const resultingHead: ConversationHead = {
        ...head,
        revision: head.revision + 1,
        activeEntryId: finalBatch
          ? source.activeEntryId
          : batch.at(-1)!.entryId,
      };
      const transition: ConversationTransition = {
        schemaVersion: 1,
        transitionId,
        conversationId: source.conversationId,
        revision: resultingHead.revision,
        kind: "history_imported",
        commandId,
        inputFingerprint: fingerprint,
        actor: { kind: "migration" },
        cause: {
          kind: "legacy_history_import",
          sourceLocator: source.sourceLocator,
          sourceDigest: source.sourceDigest,
          batchIndex,
          batchCount: batches.length,
        },
        committedAt: source.importedAt,
        entries: transitionEntries,
        evidenceReferences: [],
        resultingHead,
      };
      const outcome = await this.transitions.commit({
        namespaceId: identity.namespaceId,
        executionIncarnationId: identity.executionIncarnationId,
        operationKind: "migrate_legacy_conversation",
        ownerKind: "conversation",
        ownerId: source.conversationId,
        commandId,
        fingerprintVersion: 1,
        fingerprint,
        expectedHeads: [
          {
            conversationId: source.conversationId,
            revision: head.revision,
            selectionEpoch: 0,
            ...(batchIndex === 0 ? { createIfMissing: true } : {}),
          },
        ],
        transitions: [transition],
        outcome: resultingHead,
        publicationIntents: [],
        now: source.importedAt,
      });
      if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
        throw new Error(
          `Legacy conversation import was rejected: ${outcome.kind}`,
        );
      }
      head = resultingHead;
    }
    return head;
  }
}

function validateAndOrderSource(
  source: LegacyConversationImportSource,
): CanonicalConversationEntry[] {
  if (!/^sha256:[a-f0-9]{64}$/.test(source.sourceDigest)) {
    throw new Error("Legacy conversation source digest is invalid.");
  }
  const byId = new Map<string, ConversationEntry>();
  for (const entry of source.entries) {
    if (entry.conversationId !== source.conversationId) {
      throw new Error("Legacy entry belongs to a different conversation.");
    }
    if (byId.has(entry.id))
      throw new Error(`Duplicate legacy entry '${entry.id}'.`);
    byId.set(entry.id, entry);
  }
  if (source.activeEntryId !== null && !byId.has(source.activeEntryId)) {
    throw new Error(
      "Legacy active selection is not present in its conversation.",
    );
  }
  for (const entry of source.entries) {
    if (entry.parentEntryId && !byId.has(entry.parentEntryId)) {
      throw new Error(`Legacy entry '${entry.id}' has a missing parent.`);
    }
  }

  const ordered: ConversationEntry[] = [];
  const pending = new Map(byId);
  while (pending.size > 0) {
    let progressed = false;
    for (const entry of source.entries) {
      if (!pending.has(entry.id)) continue;
      if (!entry.parentEntryId || !pending.has(entry.parentEntryId)) {
        ordered.push(entry);
        pending.delete(entry.id);
        progressed = true;
      }
    }
    if (!progressed)
      throw new Error("Legacy conversation parentage contains a cycle.");
  }

  return ordered.map((entry, ordinal) => ({
    schemaVersion: 1,
    entryId: entry.id,
    conversationId: source.conversationId,
    transitionId: "transition_pending_migration",
    ordinal,
    parentEntryId: entry.parentEntryId ?? null,
    kind:
      entry.kind === "branch_summary" || entry.kind === "compaction"
        ? "summary"
        : entry.role === "user"
          ? "user_message"
          : "assistant_message",
    inlineContent: {
      text: entry.text,
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(entry.details === undefined ? {} : { details: entry.details }),
    },
    artifacts: [],
    ...(entry.runId ? { runId: entry.runId } : {}),
    provenance: {
      kind: "legacy_import",
      legacyRole: entry.role,
      legacyKind: entry.kind,
      legacyCreatedAt: entry.createdAt,
      sourceLocator: source.sourceLocator,
      sourceDigest: source.sourceDigest,
    },
  }));
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function stableHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
