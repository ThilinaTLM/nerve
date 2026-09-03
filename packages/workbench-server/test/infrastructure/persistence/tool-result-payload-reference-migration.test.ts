import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  ConversationJournalCommit,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import {
  toolResultPayloadReferenceSchema,
  type ToolCallRecord,
} from "@nervekit/contracts/tools";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import {
  initializeStorage,
  storagePaths,
} from "../../../src/infrastructure/storage-bootstrap/index.js";

const conversationId = "conv_payload_migration";
const now = "2026-09-03T00:00:00.000Z";
const payload = Buffer.from('{"complete":true}\n', "utf8");
const digest = createHash("sha256").update(payload).digest("hex");

function conversation(title: string): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_payload_migration",
    title,
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: now,
    updatedAt: now,
  };
}

function toolCall(id: string): ToolCallRecord {
  const segment = id.slice("tool_".length);
  return {
    id,
    agentId: "agent_payload_migration",
    conversationId,
    projectId: "proj_payload_migration",
    toolName: "bash",
    risk: "command",
    args: { command: "printf test" },
    cwd: "/tmp/project",
    status: "completed",
    phase: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    result: { stdout: "bounded" },
    resultPayload: {
      version: 2,
      kind: "tool_result",
      conversationId,
      toolCallId: id,
      logicalPath: `conversations/payload_migration/tool-calls/${segment}/result.json`,
      digest,
      byteLength: payload.byteLength,
      mediaType: "application/json",
      encoding: "utf-8",
      completeness: "complete",
    },
    createdAt: now,
    updatedAt: now,
    settledAt: now,
  };
}

async function legacyFixture(): Promise<{
  home: string;
  corruptLatestChecksum(): void;
  addLegacyRpcIdempotencyEntries(): void;
}> {
  const home = await mkdtemp(join(tmpdir(), "nerve-payload-reference-v1-"));
  const storage = await initializeStorage(home);
  const journal = new ConversationJournalRepository(storage);
  await journal.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Before migration"),
      },
    ],
  });
  await journal.commit(conversationId, {
    kind: "tool_call.revised",
    committedAt: now,
    events: [
      {
        kind: "tool_call.upserted",
        conversationId,
        toolCall: toolCall("tool_snapshot"),
      },
    ],
  });
  await journal.checkpointLoaded();
  await journal.commit(conversationId, {
    kind: "tool_call.revised",
    committedAt: now,
    events: [
      {
        kind: "tool_call.upserted",
        conversationId,
        toolCall: toolCall("tool_commit"),
      },
    ],
  });
  await journal.commit(conversationId, {
    kind: "conversation.updated",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("After migration"),
      },
    ],
  });
  await storage.canonicalStore.close();

  const paths = storagePaths(home);
  const legacyResult = join(
    paths.dataPath,
    "payloads",
    "conversations",
    conversationId,
    "tool-calls",
    "tool_snapshot",
    "result.json",
  );
  await mkdir(join(legacyResult, ".."), { recursive: true });
  await writeFile(legacyResult, payload);

  const database = new DatabaseSync(paths.sqlitePath);
  downgradeDatabase(database);
  database.close();

  const ledger = JSON.parse(
    await readFile(paths.migrationLedgerPath, "utf8"),
  ) as { entries: Array<{ id: string }> };
  ledger.entries = ledger.entries.filter(
    (entry) => entry.id !== "tool-result-payload-reference-v2",
  );
  await writeFile(paths.migrationLedgerPath, `${JSON.stringify(ledger)}\n`);

  return {
    home,
    corruptLatestChecksum() {
      const corrupt = new DatabaseSync(paths.sqlitePath);
      const row = corrupt
        .prepare(
          `SELECT data FROM domain_documents
           WHERE namespace = 'conversation_journal_commit'
             AND scope_id = ? ORDER BY document_id DESC LIMIT 1`,
        )
        .get(conversationId) as { data: Uint8Array };
      const commit = decode(row.data) as Record<string, unknown>;
      commit.checksum = `sha256:${"f".repeat(64)}`;
      corrupt
        .prepare(
          `UPDATE domain_documents SET data = ?
           WHERE namespace = 'conversation_journal_commit'
             AND scope_id = ? AND document_id = ?`,
        )
        .run(
          encode(commit),
          conversationId,
          String(commit.revision).padStart(20, "0"),
        );
      corrupt.close();
    },
    addLegacyRpcIdempotencyEntries() {
      const database = new DatabaseSync(paths.sqlitePath);
      const insert = database.prepare(
        `INSERT INTO rpc_idempotency (
           scope, key, method, params_hash, outcome, expires_at_ms, created_at_ms
         ) VALUES (?, ?, 'tool.test', 'hash', ?, ?, ?)`,
      );
      const outcome = encode({
        status: "success",
        result: downgradeToolCall(toolCall("tool_snapshot")),
      });
      insert.run("session", "expired", outcome, 1, 0);
      insert.run("session", "unexpired", outcome, 9_999_999_999_999, 1);
      database.close();
    },
  };
}

test("migrates legacy payload references and rechains conversation journals", async (t) => {
  const fixture = await legacyFixture();
  const cleanup: {
    storage?: Awaited<ReturnType<typeof initializeStorage>>;
  } = {};
  t.after(async () => {
    await cleanup.storage?.canonicalStore.close();
    await rm(fixture.home, { recursive: true, force: true });
  });

  const progress: string[] = [];
  const storage = await initializeStorage(fixture.home, {
    reportStartupProgress: (event) => progress.push(event.phase),
  });
  cleanup.storage = storage;

  assert.deepEqual(progress, ["storage-check", "storage-migration"]);
  assert.ok(storage.timings.sqliteMigrationApplyMs >= 0);
  const ledger = JSON.parse(
    await readFile(storage.paths.migrationLedgerPath, "utf8"),
  ) as {
    entries: Array<{
      id: string;
      counts?: Record<string, number>;
    }>;
  };
  const entry = ledger.entries.find(
    (candidate) => candidate.id === "tool-result-payload-reference-v2",
  );
  assert.deepEqual(entry?.counts, {
    conversations: 1,
    journalCommits: 2,
    snapshots: 1,
    durableEvents: 2,
    conversationRecords: 2,
    fileAssets: 1,
    rpcIdempotencyEntries: 0,
  });

  const repository = new ConversationJournalRepository(storage);
  const state = await repository.load(conversationId);
  assert.equal(state.revision, 4);
  assert.equal(state.conversation?.title, "After migration");
  assert.deepEqual(
    [...state.toolCalls.values()].map(
      (record) => record.resultPayload?.logicalPath,
    ),
    [
      "conversations/payload_migration/tool-calls/snapshot/result.json",
      "conversations/payload_migration/tool-calls/commit/result.json",
    ],
  );

  assert.equal(
    toolResultPayloadReferenceSchema.safeParse({
      ...toolCall("tool_snapshot").resultPayload,
      version: 1,
      logicalPath:
        "payloads/conversations/conv_payload_migration/tool-calls/tool_snapshot/result.json",
    }).success,
    false,
  );
  const currentResult = join(
    storage.paths.conversationsPath,
    "payload_migration",
    "tool-calls",
    "snapshot",
    "result.json",
  );
  assert.equal(await readFile(currentResult, "utf8"), payload.toString("utf8"));
  await assert.rejects(stat(join(storage.paths.dataPath, "payloads")), {
    code: "ENOENT",
  });

  const database = new DatabaseSync(storage.paths.sqlitePath, {
    readOnly: true,
  });
  const legacyRows = database
    .prepare(
      `SELECT (
         SELECT COUNT(*) FROM domain_documents
         WHERE instr(CAST(data AS TEXT), '"version":1,"kind":"tool_result"') > 0
       ) + (
         SELECT COUNT(*) FROM durable_events
         WHERE instr(CAST(data AS TEXT), '"version":1,"kind":"tool_result"') > 0
       ) + (
         SELECT COUNT(*) FROM conversation_records
         WHERE instr(CAST(data AS TEXT), '"version":1,"kind":"tool_result"') > 0
       ) AS count`,
    )
    .get() as { count: number };
  const asset = database
    .prepare(`SELECT logical_path FROM file_assets WHERE id = 'asset_legacy'`)
    .get() as { logical_path: string };
  database.close();
  assert.equal(legacyRows.count, 0);
  assert.equal(
    asset.logical_path,
    "conversations/payload_migration/tool-calls/snapshot/result.json",
  );

  const repeated = await initializeStorage(fixture.home, {
    reportStartupProgress: (event) => progress.push(event.phase),
  });
  await repeated.canonicalStore.close();
  assert.deepEqual(progress, [
    "storage-check",
    "storage-migration",
    "storage-check",
  ]);
});

test("migrates imported snapshots that have no journal head", async (t) => {
  const fixture = await legacyFixture();
  const cleanup: {
    storage?: Awaited<ReturnType<typeof initializeStorage>>;
  } = {};
  t.after(async () => {
    await cleanup.storage?.canonicalStore.close();
    await rm(fixture.home, { recursive: true, force: true });
  });
  const paths = storagePaths(fixture.home);
  const database = new DatabaseSync(paths.sqlitePath);
  database
    .prepare(
      `DELETE FROM domain_documents
       WHERE scope_id = ? AND namespace IN (
         'conversation_journal_commit', 'conversation_journal_head'
       )`,
    )
    .run(conversationId);
  database.close();

  const storage = await initializeStorage(fixture.home);
  cleanup.storage = storage;
  const state = await new ConversationJournalRepository(storage).load(
    conversationId,
  );
  assert.equal(state.revision, 2);
  assert.equal(state.toolCalls.get("tool_snapshot")?.resultPayload?.version, 2);
});

test("fails closed on a corrupt legacy journal without changing payload files", async (t) => {
  const fixture = await legacyFixture();
  t.after(() => rm(fixture.home, { recursive: true, force: true }));
  fixture.corruptLatestChecksum();
  const paths = storagePaths(fixture.home);
  const legacyResult = join(
    paths.dataPath,
    "payloads",
    "conversations",
    conversationId,
    "tool-calls",
    "tool_snapshot",
    "result.json",
  );
  const currentResult = join(
    paths.conversationsPath,
    "payload_migration",
    "tool-calls",
    "snapshot",
    "result.json",
  );

  await assert.rejects(initializeStorage(fixture.home), /checksum mismatch/);
  assert.equal(await readFile(legacyResult, "utf8"), payload.toString("utf8"));
  await assert.rejects(stat(currentResult), { code: "ENOENT" });
  await assertMigrationNotRecorded(fixture.home);
});

test("discards legacy RPC idempotency outcomes during migration", async (t) => {
  const fixture = await legacyFixture();
  t.after(() => rm(fixture.home, { recursive: true, force: true }));
  fixture.addLegacyRpcIdempotencyEntries();

  const storage = await initializeStorage(fixture.home);
  await storage.canonicalStore.close();
  const database = new DatabaseSync(storage.paths.sqlitePath, {
    readOnly: true,
  });
  const count = database
    .prepare(`SELECT COUNT(*) AS count FROM rpc_idempotency`)
    .get() as { count: number };
  database.close();
  assert.equal(count.count, 0);

  const ledger = JSON.parse(
    await readFile(storage.paths.migrationLedgerPath, "utf8"),
  ) as { entries: Array<{ id: string; counts?: Record<string, number> }> };
  assert.equal(
    ledger.entries.find(
      (entry) => entry.id === "tool-result-payload-reference-v2",
    )?.counts?.rpcIdempotencyEntries,
    2,
  );
});

test("resumes when legacy and current payload files are identical", async (t) => {
  const fixture = await legacyFixture();
  t.after(() => rm(fixture.home, { recursive: true, force: true }));
  const currentResult = join(
    storagePaths(fixture.home).conversationsPath,
    "payload_migration",
    "tool-calls",
    "snapshot",
    "result.json",
  );
  await mkdir(join(currentResult, ".."), { recursive: true });
  await writeFile(currentResult, payload);

  const storage = await initializeStorage(fixture.home);
  await storage.canonicalStore.close();
  assert.equal(await readFile(currentResult, "utf8"), payload.toString("utf8"));
  await assert.rejects(stat(join(storage.paths.dataPath, "payloads")), {
    code: "ENOENT",
  });
});

test("fails closed when legacy and current payload files conflict", async (t) => {
  const fixture = await legacyFixture();
  t.after(() => rm(fixture.home, { recursive: true, force: true }));
  const currentResult = join(
    storagePaths(fixture.home).conversationsPath,
    "payload_migration",
    "tool-calls",
    "snapshot",
    "result.json",
  );
  await mkdir(join(currentResult, ".."), { recursive: true });
  await writeFile(currentResult, "different payload");

  await assert.rejects(initializeStorage(fixture.home), /file conflict/);
  assert.equal(
    await readFile(
      join(
        storagePaths(fixture.home).dataPath,
        "payloads",
        "conversations",
        conversationId,
        "tool-calls",
        "tool_snapshot",
        "result.json",
      ),
      "utf8",
    ),
    payload.toString("utf8"),
  );
  await assertMigrationNotRecorded(fixture.home);
});

async function assertMigrationNotRecorded(home: string): Promise<void> {
  const ledger = JSON.parse(
    await readFile(storagePaths(home).migrationLedgerPath, "utf8"),
  ) as { entries: Array<{ id: string }> };
  assert.equal(
    ledger.entries.some(
      (entry) => entry.id === "tool-result-payload-reference-v2",
    ),
    false,
  );
}

function downgradeDatabase(database: DatabaseSync): void {
  const snapshotRow = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_state'
         AND scope_id = ? AND document_id = 'state'`,
    )
    .get(conversationId) as { data: Uint8Array };
  const snapshot = decode(snapshotRow.data) as {
    checksum: string;
    toolCalls: Array<[string, ToolCallRecord]>;
  };
  snapshot.toolCalls = snapshot.toolCalls.map(([id, record]) => [
    id,
    downgradeToolCall(record),
  ]);
  database
    .prepare(
      `UPDATE domain_documents SET data = ?
       WHERE namespace = 'conversation_state'
         AND scope_id = ? AND document_id = 'state'`,
    )
    .run(encode(snapshot), conversationId);

  let previousChecksum: string | undefined = snapshot.checksum;
  const rows = database
    .prepare(
      `SELECT document_id, data FROM domain_documents
       WHERE namespace = 'conversation_journal_commit'
         AND scope_id = ? ORDER BY document_id`,
    )
    .all(conversationId) as unknown as Array<{
    document_id: string;
    data: Uint8Array;
  }>;
  for (const row of rows) {
    const commit = decode(row.data) as ConversationJournalCommit;
    commit.events = commit.events.map((event) =>
      event.kind === "tool_call.upserted"
        ? { ...event, toolCall: downgradeToolCall(event.toolCall) }
        : event,
    );
    commit.previousChecksum = previousChecksum;
    const base = Object.fromEntries(
      Object.entries(commit).filter(([key]) => key !== "checksum"),
    );
    commit.checksum = checksum(base);
    previousChecksum = commit.checksum;
    database
      .prepare(
        `UPDATE domain_documents SET data = ?
         WHERE namespace = 'conversation_journal_commit'
           AND scope_id = ? AND document_id = ?`,
      )
      .run(encode(commit), conversationId, row.document_id);
  }
  database
    .prepare(
      `UPDATE domain_documents SET data = ?
       WHERE namespace = 'conversation_journal_head'
         AND scope_id = ? AND document_id = 'head'`,
    )
    .run(encode({ revision: 4, checksum: previousChecksum }), conversationId);

  const durableRows = database
    .prepare(
      `SELECT row_id, data FROM durable_events
       WHERE conversation_id = ? ORDER BY row_id`,
    )
    .all(conversationId) as unknown as Array<{
    row_id: number;
    data: Uint8Array;
  }>;
  for (const row of durableRows) {
    const data = decode(row.data) as {
      version: number;
      events: ConversationJournalCommit["events"];
    };
    data.events = data.events.map((event) =>
      event.kind === "tool_call.upserted"
        ? { ...event, toolCall: downgradeToolCall(event.toolCall) }
        : event,
    );
    database
      .prepare(`UPDATE durable_events SET data = ? WHERE row_id = ?`)
      .run(encode(data), row.row_id);
  }

  const recordRows = database
    .prepare(
      `SELECT id, data FROM conversation_records
       WHERE conversation_id = ? AND kind = 'tool_call'`,
    )
    .all(conversationId) as unknown as Array<{
    id: string;
    data: Uint8Array;
  }>;
  for (const row of recordRows) {
    const data = decode(row.data) as {
      version: number;
      toolCall: ToolCallRecord;
    };
    data.toolCall = downgradeToolCall(data.toolCall);
    database
      .prepare(`UPDATE conversation_records SET data = ? WHERE id = ?`)
      .run(encode(data), row.id);
  }

  database
    .prepare(
      `INSERT INTO file_assets (
         id, category, logical_path, conversation_id, tool_call_id, task_id,
         digest, byte_length, media_type, created_at_ms, updated_at_ms
       ) VALUES (
         'asset_legacy', 'payload', ?, ?, 'tool_snapshot', NULL,
         ?, ?, 'application/json', 1, 1
       )`,
    )
    .run(
      "payloads/conversations/conv_payload_migration/tool-calls/tool_snapshot/result.json",
      conversationId,
      digest,
      payload.byteLength,
    );
}

function downgradeToolCall(record: ToolCallRecord): ToolCallRecord {
  if (!record.resultPayload) return record;
  return {
    ...record,
    resultPayload: {
      ...record.resultPayload,
      version: 1,
      logicalPath: `payloads/conversations/${record.conversationId}/tool-calls/${record.id}/result.json`,
    } as never,
  };
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function decode(value: Uint8Array): unknown {
  return JSON.parse(Buffer.from(value).toString("utf8")) as unknown;
}
