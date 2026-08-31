import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import { PerformanceMetricsCollector } from "../../../src/infrastructure/diagnostics/performance-metrics.js";
import { ConversationJournalRepository as CanonicalConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";

const repositories: ConversationJournalRepository[] = [];
class ConversationJournalRepository extends CanonicalConversationJournalRepository {
  constructor(
    ...args: ConstructorParameters<
      typeof CanonicalConversationJournalRepository
    >
  ) {
    super(...args);
    repositories.push(this);
  }
}
test.afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((repository) => repository.close()),
  );
});

const conversationId = "conv_journal_test";
const now = "2026-08-23T00:00:00.000Z";

function conversation(title: string): ConversationRecord {
  return {
    id: conversationId,
    projectId: "proj_journal_test",
    title,
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: now,
    updatedAt: now,
  };
}

test("conversation journal single-flights concurrent aggregate loads", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-single-flight-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const seed = new ConversationJournalRepository({ paths: { home } });
  await seed.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Single flight"),
      },
    ],
  });
  await seed.checkpointLoaded();

  const repository = new ConversationJournalRepository({ paths: { home } });
  const [left, right] = await Promise.all([
    repository.load(conversationId),
    repository.load(conversationId),
  ]);
  assert.equal(left, right);
  assert.equal(repository.residentStats().residentCount, 1);
});

test("conversation journal bounds clean resident aggregates", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-resident-bound-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const seed = new ConversationJournalRepository({ paths: { home } });
  for (const id of ["conv_bound_a", "conv_bound_b", "conv_bound_c"]) {
    await seed.commit(id, {
      kind: "conversation.created",
      committedAt: now,
      events: [
        {
          kind: "conversation.upserted",
          conversationId: id,
          conversation: { ...conversation(id), id },
        },
      ],
    });
  }
  await seed.checkpointLoaded();

  const repository = new ConversationJournalRepository(
    { paths: { home } },
    undefined,
    { maxResidentConversations: 2 },
  );
  await repository.load("conv_bound_a");
  await repository.load("conv_bound_b");
  await repository.load("conv_bound_c");
  assert.equal(repository.residentStats().residentCount, 2);
  assert.equal(repository.state("conv_bound_a"), undefined);
});

test("conversation journal records bounded commit diagnostics", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-metrics-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const metrics = new PerformanceMetricsCollector();
  const repository = new ConversationJournalRepository(
    { paths: { home } },
    metrics,
  );
  await repository.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Measured"),
      },
    ],
  });
  const snapshot = metrics.snapshotAndReset();
  assert.equal(snapshot.metrics["conversation.commitEvents"]?.count, 1);
  assert.equal(snapshot.metrics["conversation.commitRecords"]?.count, 0);
  assert.equal(snapshot.metrics["conversation.commitPrepare"]?.count, 1);
  assert.equal(snapshot.metrics["conversation.commitPersist"]?.count, 1);
});

test("conversation journal commits are chained and idempotent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-idempotent-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const first = new ConversationJournalRepository({ paths: { home } });
  const input = {
    kind: "conversation.created",
    idempotencyKey: "create-conversation",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted" as const,
        conversationId,
        conversation: conversation("Journal test"),
      },
    ],
  };
  const committed = await first.commit(conversationId, input);
  const repeated = await new ConversationJournalRepository({
    paths: { home },
  }).commit(conversationId, input);
  assert.equal(repeated.commitId, committed.commitId);

  const replayed = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(replayed.revision, 1);
  assert.equal(replayed.conversation?.title, "Journal test");
  assert.match(replayed.checksum, /^sha256:[a-f0-9]{64}$/);
});

test("conversation metadata and transcript projections do not hydrate aggregates", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-projections-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const seed = new ConversationJournalRepository({ paths: { home } });
  await seed.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Projected"),
      },
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          id: "entry_projected",
          conversationId,
          role: "user",
          text: "Projection only",
          createdAt: now,
        },
      },
    ],
  });

  const repository = new ConversationJournalRepository({ paths: { home } });
  assert.deepEqual(
    (await repository.listConversationMetadata()).map((item) => item.title),
    ["Projected"],
  );
  assert.deepEqual(
    (await repository.readConversationEntries(conversationId)).map(
      (entry) => entry.id,
    ),
    ["entry_projected"],
  );
  assert.equal(repository.residentStats().residentCount, 0);
});

test("conversation entry appends are first-write-wins by id", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-entry-idempotent-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  const original: ConversationEntry = {
    id: "entry_task_event",
    conversationId,
    role: "system",
    kind: "task_event",
    text: "Task completed",
    createdAt: now,
  };
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      { kind: "conversation.entry_appended", conversationId, entry: original },
    ],
  });
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          ...original,
          parentEntryId: "entry_concurrent_parent",
          text: "Task completed with regenerated details",
        },
      },
    ],
  });

  const state = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(state.revision, 2);
  assert.deepEqual(state.entries, [original]);
});

test("conversation commits materialize typed records and durable events", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-record-materialize-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    committedAt: now,
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: {
          id: "entry_materialized",
          conversationId,
          role: "user",
          text: "Durable",
          createdAt: now,
        },
      },
    ],
  });
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  const record = database
    .prepare(
      `SELECT kind, sequence, revision FROM conversation_records WHERE id = ?`,
    )
    .get("entry_materialized") as Record<string, unknown>;
  assert.deepEqual(
    { ...record },
    {
      kind: "message",
      sequence: 1,
      revision: 1,
    },
  );
  const event = database
    .prepare(`SELECT event_type FROM durable_events WHERE conversation_id = ?`)
    .get(conversationId) as { event_type: string };
  assert.equal(event.event_type, "conversation.entry_appended");
});

test("hot journal commits update only affected materialized records", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-record-incremental-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  const entry = (id: string, text: string): ConversationEntry => ({
    id,
    conversationId,
    role: "user",
    text,
    createdAt: now,
  });
  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: entry("entry_preserved", "First"),
      },
    ],
  });

  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE record_delete_audit (id TEXT NOT NULL) STRICT;
    CREATE TRIGGER audit_conversation_record_delete
    AFTER DELETE ON conversation_records
    BEGIN
      INSERT INTO record_delete_audit (id) VALUES (OLD.id);
    END;
  `);

  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: entry("entry_added", "Second"),
      },
    ],
  });

  const audit = database
    .prepare(`SELECT COUNT(*) AS count FROM record_delete_audit`)
    .get() as { count: number };
  assert.equal(audit.count, 0);
  const records = database
    .prepare(
      `SELECT id FROM conversation_records WHERE conversation_id = ? ORDER BY sequence`,
    )
    .all(conversationId) as Array<{ id: string }>;
  assert.deepEqual(
    records.map((record) => record.id),
    ["entry_preserved", "entry_added"],
  );
});

test("hot commits append bounded deltas without rewriting the checkpoint", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-delta-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  const entry = (id: string): ConversationEntry => ({
    id,
    conversationId,
    role: "user",
    text: id,
    createdAt: now,
  });
  for (let index = 0; index < 100; index += 1) {
    await repository.commit(conversationId, {
      kind: "conversation.entry_appended",
      events: [
        {
          kind: "conversation.entry_appended",
          conversationId,
          entry: entry(`entry_history_${index}`),
        },
      ],
    });
  }
  await repository.checkpointLoaded();
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  const checkpointBefore = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_state' AND scope_id = ?`,
    )
    .get(conversationId) as { data: Uint8Array };

  await repository.commit(conversationId, {
    kind: "conversation.entry_appended",
    events: [
      {
        kind: "conversation.entry_appended",
        conversationId,
        entry: entry("entry_delta"),
      },
    ],
  });

  const checkpointAfter = database
    .prepare(
      `SELECT data FROM domain_documents
       WHERE namespace = 'conversation_state' AND scope_id = ?`,
    )
    .get(conversationId) as { data: Uint8Array };
  assert.deepEqual(checkpointAfter.data, checkpointBefore.data);
  const deltas = database
    .prepare(
      `SELECT COUNT(*) AS count FROM domain_documents
       WHERE namespace = 'conversation_journal_commit' AND scope_id = ?`,
    )
    .get(conversationId) as { count: number };
  assert.equal(deltas.count, 1);

  const loaded = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(loaded.entries.length, 101);
  assert.equal(loaded.entries.at(-1)?.id, "entry_delta");
});

test("checkpointing atomically folds replay deltas", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-checkpoint-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await repository.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Checkpointed"),
      },
    ],
  });
  await repository.checkpointLoaded();

  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  const deltaCount = database
    .prepare(
      `SELECT COUNT(*) AS count FROM domain_documents
       WHERE namespace = 'conversation_journal_commit' AND scope_id = ?`,
    )
    .get(conversationId) as { count: number };
  assert.equal(deltaCount.count, 0);
  const loaded = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.conversation?.title, "Checkpointed");
});

test("SQLite journal head rejects a stale repository without mutating it", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-head-cas-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const first = new ConversationJournalRepository({ paths: { home } });
  await first.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Initial"),
      },
    ],
  });
  const stale = new ConversationJournalRepository({ paths: { home } });
  const staleState = await stale.load(conversationId);
  await first.commit(conversationId, {
    kind: "conversation.upserted",
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Current"),
      },
    ],
  });

  await assert.rejects(
    stale.commit(conversationId, {
      kind: "conversation.upserted",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: conversation("Stale"),
        },
      ],
    }),
    /[Cc]onflict/,
  );
  assert.equal(staleState.revision, 1);
  assert.equal(staleState.conversation?.title, "Initial");
});

test("hot leaf commits update only the affected context owner", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-leaf-delta-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await repository.commit(conversationId, {
    kind: "model_context.entry_appended",
    committedAt: now,
    events: ["agent_a", "agent_b"].map((ownerAgentId) => ({
      kind: "model_context.entry_appended" as const,
      conversationId,
      ownerAgentId,
      entry: {
        type: "custom_message",
        id: `entry_model_${ownerAgentId}`,
        parentId: null,
        timestamp: now,
        customType: "test",
        content: ownerAgentId,
        display: true,
      } as never,
    })),
  });
  await repository.checkpointLoaded();
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE leaf_audit (operation TEXT NOT NULL, agent_id TEXT NOT NULL) STRICT;
    CREATE TRIGGER audit_leaf_update AFTER UPDATE ON agent_context_leaves
    BEGIN
      INSERT INTO leaf_audit VALUES ('update', NEW.agent_id);
    END;
    CREATE TRIGGER audit_leaf_delete AFTER DELETE ON agent_context_leaves
    BEGIN
      INSERT INTO leaf_audit VALUES ('delete', OLD.agent_id);
    END;
  `);

  await repository.commit(conversationId, {
    kind: "model_context.leaf_changed",
    events: [
      {
        kind: "model_context.leaf_changed",
        conversationId,
        ownerAgentId: "agent_a",
        entryId: "entry_model_agent_a",
      },
    ],
  });

  const audit = database
    .prepare(`SELECT operation, agent_id FROM leaf_audit ORDER BY rowid`)
    .all() as Array<{ operation: string; agent_id: string }>;
  assert.deepEqual(
    audit.map((row) => ({ ...row })),
    [{ operation: "update", agent_id: "agent_a" }],
  );
});

test("failed delta persistence leaves the resident projection unchanged", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-rollback-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await repository.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Before failure"),
      },
    ],
  });
  const state = await repository.load(conversationId);
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  t.after(() => database.close());
  database.exec(`
    CREATE TRIGGER reject_conversation_delta
    BEFORE INSERT ON domain_documents
    WHEN NEW.namespace = 'conversation_journal_commit'
    BEGIN
      SELECT RAISE(ABORT, 'forced delta failure');
    END;
  `);

  await assert.rejects(
    repository.commit(conversationId, {
      kind: "conversation.upserted",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: conversation("Must not apply"),
        },
      ],
    }),
    /forced delta failure/,
  );
  assert.equal(state.revision, 1);
  assert.equal(state.conversation?.title, "Before failure");
});

test("legacy detached agent compactions hydrate as context roots", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-agent-compaction-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  const detachedCompaction = (id: string, parentId: string) => ({
    type: "compaction" as const,
    id,
    parentId,
    timestamp: now,
    summary: `Summary ${id}`,
    firstKeptEntryId: parentId,
    tokensBefore: 100,
  });

  await repository.commit(conversationId, {
    kind: "migration.agent_model_context",
    events: [
      detachedCompaction("entry_compaction_one", "entry_shared_one"),
      detachedCompaction("entry_compaction_two", "entry_shared_two"),
    ].map((entry) => ({
      kind: "model_context.entry_appended" as const,
      conversationId,
      ownerAgentId: "agent_legacy",
      entry: entry as never,
    })),
  });
  await repository.checkpointLoaded();

  const loaded = await new ConversationJournalRepository({
    paths: { home },
  }).load(conversationId);
  assert.deepEqual(
    loaded.agentModelEntries
      .get("agent_legacy")
      ?.map((entry) => entry.parentId),
    [null, null],
  );
  assert.deepEqual(
    loaded.agentModelTrees
      .get("agent_legacy")
      ?.getPathToRoot("entry_compaction_two")
      .map((entry) => entry.id),
    ["entry_compaction_two"],
  );

  await assert.rejects(
    repository.commit(conversationId, {
      kind: "model_context.entry_appended",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId,
          ownerAgentId: "agent_legacy",
          entry: {
            type: "custom_message",
            id: "entry_invalid_child",
            parentId: "entry_missing",
            timestamp: now,
            customType: "test",
            content: "invalid",
            display: true,
          } as never,
        },
      ],
    }),
    /Unknown model-context parent 'entry_missing'/,
  );
});

test("conversation storage fails closed on malformed canonical state and bad references", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-journal-corrupt-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repository = new ConversationJournalRepository({ paths: { home } });
  await assert.rejects(
    repository.commit(conversationId, {
      kind: "bad-identity",
      events: [
        {
          kind: "conversation.upserted",
          conversationId,
          conversation: { ...conversation("Wrong"), id: "conv_other" },
        },
      ],
    }),
    /identity mismatch/,
  );
  await repository.commit(conversationId, {
    kind: "conversation.created",
    committedAt: now,
    events: [
      {
        kind: "conversation.upserted",
        conversationId,
        conversation: conversation("Durable"),
      },
    ],
  });
  const database = new DatabaseSync(join(home, "data", "nerve.sqlite"));
  database
    .prepare(
      `UPDATE domain_documents SET data = ?
       WHERE namespace = 'conversation_journal_commit' AND scope_id = ?`,
    )
    .run(Buffer.from("{bad-json"), conversationId);
  database.close();
  await assert.rejects(
    new ConversationJournalRepository({ paths: { home } }).load(conversationId),
    /JSON/,
  );
});
