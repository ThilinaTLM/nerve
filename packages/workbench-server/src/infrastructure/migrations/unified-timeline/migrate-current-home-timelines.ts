import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type {
  RecoveryAction,
  RunControl,
  RunRecord,
} from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { ConversationTransitionService } from "../../../domains/conversations/timeline/conversation-transition.service.js";
import type { CanonicalStore } from "../../persistence/canonical-sqlite/canonical-store.js";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";
import { canonicalConversationJson } from "../../../domains/conversations/timeline/command-fingerprint.js";
import { createHash } from "node:crypto";
import {
  LegacyConversationTimelineImporter,
  type LegacyConversationImportProof,
} from "./import-legacy-conversation.js";

/**
 * Quiesced-current-home converter. Callers must hold the startup lock and must
 * not admit runtime writers until every proof and the final authority audit pass.
 */
export async function migrateCurrentHomeConversationTimelines(input: {
  store: CanonicalStore;
  proofDirectory: string;
  importedAt: string;
  runtimeIsolation: "proven";
  readExactMessages?: (
    conversationId: string,
  ) => Promise<Readonly<Record<string, unknown>>>;
}): Promise<LegacyConversationImportProof[]> {
  const conversations = (
    await input.store.listConversationMetadata<ConversationRecord>()
  ).sort((left, right) => left.id.localeCompare(right.id));
  await mkdir(input.proofDirectory, { recursive: true, mode: 0o700 });
  const importer = new LegacyConversationTimelineImporter(input.store);
  const proofs: LegacyConversationImportProof[] = [];
  for (const conversation of conversations) {
    const entries: ConversationEntry[] =
      await input.store.readConversationEntries(conversation.id);
    const exactMessagesByEntryId = input.readExactMessages
      ? await input.readExactMessages(conversation.id)
      : undefined;
    const sourceDigest = `sha256:${createHash("sha256")
      .update(
        canonicalConversationJson({
          schemaVersion: 1,
          conversation,
          entries,
          exactMessagesByEntryId,
        }),
      )
      .digest("hex")}`;
    const { proof } = await importer.import({
      conversationId: conversation.id,
      entries,
      activeEntryId: conversation.activeEntryId ?? null,
      sourceLocator: `sqlite:legacy-conversation-journal/${conversation.id}`,
      sourceDigest,
      importedAt: input.importedAt,
      exactMessagesByEntryId,
    });
    await atomicWriteJson(
      join(input.proofDirectory, `${conversation.id}.json`),
      proof,
      0o600,
    );
    proofs.push(proof);
  }
  const importedRunCount = await importLegacyRunControls(
    input.store,
    input.importedAt,
  );
  const toolRecovery = await importLegacyToolRecovery(
    input.store,
    input.importedAt,
  );
  await input.store.integrityCheck();
  const manifestFacts = {
    schemaVersion: 1 as const,
    sourceKind: "current_home_legacy_journal" as const,
    conversationCount: proofs.length,
    importedRunCount,
    importedToolRecordCount: toolRecovery.importedToolRecordCount,
    preparedToolRecoveryCount: toolRecovery.preparedToolRecoveryCount,
    conversationProofDigests: proofs.map((proof) => ({
      conversationId: proof.conversationId,
      proofDigest: proof.proofDigest,
    })),
  };
  await atomicWriteJson(
    join(input.proofDirectory, "manifest.json"),
    {
      ...manifestFacts,
      manifestDigest: `sha256:${createHash("sha256")
        .update(canonicalConversationJson(manifestFacts))
        .digest("hex")}`,
    },
    0o600,
  );
  return proofs;
}

async function importLegacyRunControls(
  store: CanonicalStore,
  importedAt: string,
): Promise<number> {
  const identity = await store.readTimelineStateIdentity();
  if (!identity)
    throw new Error("Canonical state identity is not initialized.");
  const transitions = new ConversationTransitionService(store);
  const runs = (await store.listRunMetadata()).sort((left, right) =>
    left.runId.localeCompare(right.runId),
  );
  for (const run of runs) {
    const head = await store.readTimelineConversationHead(run.conversationId);
    if (!head) {
      throw new Error(
        `Legacy run '${run.runId}' has no imported conversation.`,
      );
    }
    const control = legacyRunControl(
      run,
      head.activeEntryId,
      head.selectionEpoch,
    );
    const commandId = `migration-unified-run:${run.runId}`;
    const fingerprint = `sha256:${createHash("sha256")
      .update(canonicalConversationJson({ schemaVersion: 1, run, control }))
      .digest("hex")}`;
    const outcome = await transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "migrate_legacy_run_control",
      ownerKind: "conversation",
      ownerId: run.conversationId,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: run.conversationId,
          revision: head.revision,
          selectionEpoch: head.selectionEpoch,
        },
      ],
      transitions: [],
      runControls: [control],
      outcome: control,
      publicationIntents: [],
      now: importedAt,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      throw new Error(`Legacy run import was rejected: ${outcome.kind}`);
    }
  }
  return runs.length;
}

async function importLegacyToolRecovery(
  store: CanonicalStore,
  importedAt: string,
): Promise<{
  importedToolRecordCount: number;
  preparedToolRecoveryCount: number;
}> {
  const records: ToolCallRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.scanToolCalls({
      ...(cursor ? { afterId: cursor } : {}),
      maxRows: 500,
    });
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor);
  const pending = records.filter((record) =>
    ["committed", "waiting", "running"].includes(record.status),
  );
  const byConversation = new Map<string, ToolCallRecord[]>();
  for (const record of pending) {
    const group = byConversation.get(record.conversationId) ?? [];
    group.push(record);
    byConversation.set(record.conversationId, group);
  }
  const identity = await store.readTimelineStateIdentity();
  if (!identity)
    throw new Error("Canonical state identity is not initialized.");
  const transitions = new ConversationTransitionService(store);
  for (const [conversationId, conversationRecords] of byConversation) {
    for (let offset = 0; offset < conversationRecords.length; offset += 64) {
      const batch = conversationRecords.slice(offset, offset + 64);
      const head = await store.readTimelineConversationHead(conversationId);
      if (!head) {
        throw new Error(
          `Legacy tool recovery owner '${conversationId}' was not imported.`,
        );
      }
      const actions: RecoveryAction[] = [];
      for (const record of batch) {
        const run = record.runId
          ? await store.readTimelineRunControl(conversationId, record.runId)
          : undefined;
        const suffix = createHash("sha256").update(record.id).digest("hex");
        actions.push({
          schemaVersion: 1,
          actionId: `recovery_legacy_tool_${suffix.slice(0, 32)}`,
          conversationId,
          ...(run ? { runId: run.runId } : {}),
          actionKind: "reconcile_external_effect",
          evidence: {
            source: "legacy_tool_record",
            toolCallId: record.id,
            toolName: record.toolName,
            status: record.status,
            updatedAt: record.updatedAt,
            record,
          },
          status: "prepared",
          commandId: `migrate-legacy-tool-recovery:${record.id}`,
          createdAt: importedAt,
        });
      }
      const commandId = `migration-unified-tools:${conversationId}:${offset / 64}`;
      const fingerprint = `sha256:${createHash("sha256")
        .update(canonicalConversationJson(actions))
        .digest("hex")}`;
      const outcome = await transitions.commit({
        namespaceId: identity.namespaceId,
        executionIncarnationId: identity.executionIncarnationId,
        operationKind: "migrate_legacy_tool_recovery",
        ownerKind: "conversation",
        ownerId: conversationId,
        commandId,
        fingerprintVersion: 1,
        fingerprint,
        expectedHeads: [
          {
            conversationId,
            revision: head.revision,
            selectionEpoch: head.selectionEpoch,
          },
        ],
        transitions: [],
        recoveryActions: actions,
        outcome: actions.map((action) => action.actionId),
        publicationIntents: [],
        now: importedAt,
      });
      if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
        throw new Error(`Legacy tool recovery import was rejected.`);
      }
    }
  }
  return {
    importedToolRecordCount: records.length,
    preparedToolRecoveryCount: pending.length,
  };
}

function legacyRunControl(
  run: RunRecord,
  continuationEntryId: string | null,
  selectionEpoch: number,
): RunControl {
  const state: RunControl["state"] =
    run.status === "completed"
      ? "completed"
      : run.status === "failed"
        ? "failed"
        : run.status === "cancelled"
          ? "cancelled"
          : "recovery_required";
  return {
    schemaVersion: 1,
    conversationId: run.conversationId,
    runId: run.runId,
    generation: Math.max(1, run.attempt),
    boundSelectionEpoch: selectionEpoch,
    continuationEntryId,
    checkpointId: null,
    waitGroupId: null,
    providerPhaseId: null,
    state,
    foregroundOwned: false,
    revision: 1,
    ...(state === "recovery_required"
      ? { recoveryReason: "legacy_execution_authority_unproven" }
      : {}),
  };
}
