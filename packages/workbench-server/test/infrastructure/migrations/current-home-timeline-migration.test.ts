import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ConversationJournalRepository } from "../../../src/infrastructure/migrations/legacy-journal/conversation-journal.repository.js";
import { CanonicalAuthorityPromotionService } from "../../../src/domains/storage/canonical-authority-promotion.service.js";
import {
  migrateCurrentHomeConversationTimelines,
  retireMigratedLegacyRuntimeAuthority,
} from "../../../src/infrastructure/migrations/unified-timeline/migrate-current-home-timelines.js";
import { extractExactHarnessMessages } from "../../../src/infrastructure/migrations/unified-timeline/extract-exact-harness-messages.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const now = "2026-09-14T00:00:00.000Z";

test("exact legacy messages exclude model-only entries outside the migrated timeline", () => {
  const entries = [
    {
      type: "message",
      id: "entry_included",
      parentId: null,
      timestamp: now,
      message: { role: "user", content: "included", timestamp: 1 },
    },
    {
      type: "message",
      id: "entry_model_only",
      parentId: "entry_included",
      timestamp: now,
      message: { role: "assistant", content: [], timestamp: 2 },
    },
  ] as Parameters<typeof extractExactHarnessMessages>[0];
  assert.deepEqual(
    extractExactHarnessMessages(entries, new Set(["entry_included"])),
    {
      entry_included: { role: "user", content: "included", timestamp: 1 },
    },
  );
});

test("INV-MIGRATE-02 converts a quiesced current-home journal with proof", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-current-home-migration-"));
  const sqlitePath = join(home, "nerve.sqlite");
  const store = new CanonicalStore(sqlitePath);
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home, sqlitePath },
    canonicalStore: store,
  });
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await journal.commit("conv_current", {
    kind: "migration-fixture",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_current",
        conversation: {
          id: "conv_current",
          projectId: "proj_current",
          title: "Current",
          mode: "coding",
          permissionLevel: "supervised",
          activeEntryId: "entry_current",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        kind: "conversation.entry_appended",
        conversationId: "conv_current",
        entry: {
          id: "entry_current",
          conversationId: "conv_current",
          role: "user",
          kind: "message",
          text: "preserve me",
          createdAt: now,
        },
      },
      {
        kind: "tool_call.upserted",
        conversationId: "conv_current",
        toolCall: {
          id: "tool_current",
          agentId: "agent_current",
          conversationId: "conv_current",
          projectId: "proj_current",
          toolName: "write",
          risk: "workspace_write",
          args: { path: "README.md" },
          cwd: "/tmp/project",
          status: "running",
          revision: 1,
          attempt: 1,
          interactions: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  });
  const seedDatabase = new DatabaseSync(sqlitePath);
  const modelOnlyEntryId = "entry_model_only";
  const summaryEntryId = "entry_summary";
  const insertLegacyRecord = seedDatabase.prepare(
    `INSERT INTO conversation_records (
       id, conversation_id, parent_id, sequence, revision, kind, status,
       payload_version, data, created_at_ms, updated_at_ms
     ) VALUES (?, 'conv_current', ?, ?, 1, ?, 'completed', 1, ?, ?, ?)`,
  );
  insertLegacyRecord.run(
    modelOnlyEntryId,
    "entry_current",
    100,
    "message",
    Buffer.from(
      JSON.stringify({
        version: 1,
        modelContext: {
          visibility: "model_only",
          entry: {
            type: "thinking_level_change",
            id: modelOnlyEntryId,
            parentId: "entry_current",
            timestamp: now,
            thinkingLevel: "high",
          },
        },
      }),
    ),
    Date.parse(now),
    Date.parse(now),
  );
  insertLegacyRecord.run(
    summaryEntryId,
    modelOnlyEntryId,
    101,
    "summary",
    Buffer.from(
      JSON.stringify({
        version: 1,
        entry: {
          id: summaryEntryId,
          conversationId: "conv_current",
          parentEntryId: modelOnlyEntryId,
          role: "system",
          kind: "compaction",
          text: "preserved summary",
          createdAt: now,
        },
        modelContext: {
          visibility: "model_and_history",
          entry: {
            type: "compaction",
            id: summaryEntryId,
            parentId: modelOnlyEntryId,
            timestamp: now,
            summary: "preserved summary",
            firstKeptEntryId: "entry_current",
            tokensBefore: 10,
          },
        },
      }),
    ),
    Date.parse(now),
    Date.parse(now),
  );
  insertLegacyRecord.run(
    "run_current",
    summaryEntryId,
    102,
    "run",
    Buffer.from(
      JSON.stringify({
        version: 1,
        run: {
          stateEpoch: 1,
          conversationId: "conv_current",
          agentId: "agent_current",
          projectId: "proj_current",
          runId: "run_current",
          scopeId: "scope_current",
          revision: 7,
          status: "completed",
          recoverability: "not_needed",
          executionId: "exec_current",
          attempt: 3,
          createdAt: now,
          updatedAt: now,
          terminalAt: now,
          cancellationEvidence: [],
        },
      }),
    ),
    Date.parse(now),
    Date.parse(now),
  );
  seedDatabase
    .prepare(
      `UPDATE domain_documents
          SET data = CAST(json_set(
            CAST(data AS TEXT), '$.activeEntryId', ?
          ) AS BLOB)
        WHERE namespace = 'conversation' AND scope_id = 'global'
          AND document_id = 'conv_current'`,
    )
    .run(summaryEntryId);
  seedDatabase
    .prepare(
      `INSERT INTO lifecycle_work (
         id, deduplication_key, conversation_id, kind, state, input_hash,
         generation, attempt_count, not_before_ms, payload_version, data,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, 'continue_model', 'ready', ?, 0, 0, ?, 1, ?, ?, ?)`,
    )
    .run(
      "work_current",
      "work-current",
      "conv_current",
      `sha256:${"b".repeat(64)}`,
      Date.parse(now),
      Buffer.from("{}"),
      Date.parse(now),
      Date.parse(now),
    );
  seedDatabase.close();

  const proofDirectory = join(home, "migration-proofs");
  const first = await migrateCurrentHomeConversationTimelines({
    store,
    proofDirectory,
    importedAt: "2026-09-14T00:00:01.000Z",
    runtimeIsolation: "proven",
    readExactMessages: async () => ({
      entry_current: { role: "user", content: "preserve me", timestamp: 1 },
    }),
  });
  const replay = await migrateCurrentHomeConversationTimelines({
    store,
    proofDirectory,
    importedAt: "2026-09-14T00:00:01.000Z",
    runtimeIsolation: "proven",
    readExactMessages: async () => ({
      entry_current: { role: "user", content: "preserve me", timestamp: 1 },
    }),
  });
  assert.deepEqual(replay, first);
  assert.equal(first[0]?.conversationId, "conv_current");
  assert.equal(
    (await store.readTimelineConversationHead("conv_current"))?.activeEntryId,
    "entry_summary",
  );
  const ancestry = await store.readTimelineAncestrySegment(
    "conv_current",
    "entry_summary",
    2,
  );
  assert.equal(ancestry.entries[0]?.parentEntryId, "entry_current");
  const migratedRun = await store.readTimelineRunControl(
    "conv_current",
    "run_current",
  );
  assert.equal(migratedRun?.generation, 1);
  assert.equal(migratedRun?.revision, 1);
  assert.deepEqual(
    (
      ancestry.entries[1]?.inlineContent as {
        exactHarnessMessage?: unknown;
      }
    ).exactHarnessMessage,
    { role: "user", content: "preserve me", timestamp: 1 },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(proofDirectory, "conv_current.json"), "utf8"),
    ),
    first[0],
  );
  const manifest = JSON.parse(
    await readFile(join(proofDirectory, "manifest.json"), "utf8"),
  ) as {
    conversationCount: number;
    importedToolRecordCount: number;
    preparedToolRecoveryCount: number;
    importedLifecycleAuthorityCount: number;
    preparedLifecycleRecoveryCount: number;
    manifestDigest: string;
  };
  assert.equal(manifest.conversationCount, 1);
  assert.equal(manifest.importedToolRecordCount, 1);
  assert.equal(manifest.preparedToolRecoveryCount, 1);
  assert.equal(manifest.importedLifecycleAuthorityCount, 1);
  assert.equal(manifest.preparedLifecycleRecoveryCount, 1);
  assert.match(manifest.manifestDigest, /^sha256:[a-f0-9]{64}$/);

  const before = await store.readTimelineStateIdentity();
  await store.disableTimelineRuntimeAdmission("2026-09-14T00:00:02.000Z");
  const promotionService = new CanonicalAuthorityPromotionService(store);
  await assert.rejects(
    promotionService.promote({
      manifestPath: join(proofDirectory, "manifest.json"),
      oldRuntimeIsolation: "proven",
      promotedAt: "2026-09-14T00:00:03.000Z",
    }),
    /unresolved execution authority/,
  );
  const database = new DatabaseSync(sqlitePath);
  const recoveries = database
    .prepare(
      `SELECT action_kind, status, evidence_json IS NOT NULL AS has_evidence
       FROM recovery_actions WHERE conversation_id = ? ORDER BY action_id`,
    )
    .all("conv_current") as unknown as Array<{
    action_kind: string;
    status: string;
    has_evidence: number;
  }>;
  assert.equal(recoveries.length, 2);
  assert.ok(
    recoveries.every(
      (item) =>
        item.action_kind === "reconcile_external_effect" &&
        item.status === "prepared" &&
        item.has_evidence === 1,
    ),
  );
  database.close();
  assert.ok((await retireMigratedLegacyRuntimeAuthority(store)) > 0);
  assert.equal(await store.migration.countLegacyRuntimeAuthority(), 0);
  const resumedAfterRetirement = await migrateCurrentHomeConversationTimelines({
    store,
    proofDirectory,
    importedAt: "2026-09-14T00:00:01.000Z",
    runtimeIsolation: "proven",
  });
  assert.deepEqual(resumedAfterRetirement, first);
  const promotion = await promotionService.promote({
    manifestPath: join(proofDirectory, "manifest.json"),
    oldRuntimeIsolation: "proven",
    promotedAt: "2026-09-14T00:00:03.000Z",
  });
  const after = await store.readTimelineStateIdentity();
  assert.equal(
    promotion.priorExecutionIncarnationId,
    before?.executionIncarnationId,
  );
  assert.equal(after?.executionIncarnationId, promotion.executionIncarnationId);
  assert.equal(
    (await store.readTimelineRuntimeAdmission())?.dispatchState,
    "admitted",
  );
  const promotedDatabase = new DatabaseSync(sqlitePath, { readOnly: true });
  const promotionEvidence = promotedDatabase
    .prepare(
      `SELECT proof_digest, old_runtime_isolated, state
       FROM timeline_authority_promotions WHERE promotion_id = ?`,
    )
    .get(promotion.promotionId) as {
    proof_digest: string;
    old_runtime_isolated: number;
    state: string;
  };
  promotedDatabase.close();
  assert.equal(promotionEvidence.proof_digest, promotion.proofDigest);
  assert.equal(promotionEvidence.old_runtime_isolated, 1);
  assert.equal(promotionEvidence.state, "promoted");
  await assert.rejects(
    new CanonicalAuthorityPromotionService(store).promote({
      manifestPath: join(proofDirectory, "manifest.json"),
      oldRuntimeIsolation: "proven",
      promotedAt: "2026-09-14T00:00:04.000Z",
    }),
    /not fenced/,
  );
});
