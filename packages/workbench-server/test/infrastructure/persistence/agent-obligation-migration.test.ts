import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateLegacyAgentObligations } from "../../../src/infrastructure/persistence/canonical-sqlite/agent-obligation-migration.js";
import {
  decode,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/payload-codecs.js";
import {
  CANONICAL_MIGRATIONS,
  CANONICAL_SCHEMA_SQL,
} from "../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

const completionMigration = CANONICAL_MIGRATIONS.find(
  (candidate) => candidate.name === "async-subagent-completions-v5",
)!;
const obligationMigration = CANONICAL_MIGRATIONS.find(
  (candidate) => candidate.name === "agent-async-obligations-v7",
)!;

function databaseForMigration(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(CANONICAL_SCHEMA_SQL);
  database.exec(completionMigration.sql);
  database.exec(obligationMigration.sql);
  return database;
}

test("legacy subagent completions migrate once to canonical obligations", () => {
  const database = databaseForMigration();
  const legacy = {
    childId: "agent_child",
    runId: "run_child",
    leadId: "agent_lead",
    conversationId: "conv_1",
    outcome: "completed",
    entryId: "entry_notice",
    generation: 2,
    createdAt: "2026-09-27T10:00:00.000Z",
    deliveredAt: "2026-09-27T10:01:00.000Z",
    consumedAt: "2026-09-27T10:02:00.000Z",
    suppressed: false,
  };
  database
    .prepare(
      `INSERT INTO subagent_completions
       (run_id, child_id, lead_id, conversation_id, pending, data)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(
      legacy.runId,
      legacy.childId,
      legacy.leadId,
      legacy.conversationId,
      encode(legacy),
    );

  migrateLegacyAgentObligations(database);
  migrateLegacyAgentObligations(database);

  const rows = database
    .prepare(
      "SELECT id, state, notification_entry_id FROM agent_async_obligations",
    )
    .all() as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      {
        id: "async_subagent:run_child:2",
        state: "consumed",
        notification_entry_id: "entry_notice",
      },
    ],
  );
  assert.equal(
    Number(
      (
        database
          .prepare(
            `SELECT count(*) AS count FROM domain_documents
             WHERE namespace = 'canonical_data_migration'`,
          )
          .get() as { count: number }
      ).count,
    ),
    1,
  );
  database.close();
});

test("encoded promoted-task documents migrate after decode and filtering", () => {
  const database = databaseForMigration();
  const promotedTask = {
    id: "task_promoted",
    conversationId: "conv_1",
    agentId: "agent_lead",
    cwd: "/tmp",
    command: "build",
    status: "completed",
    readiness: { outcome: "none" },
    stdoutPath: "tasks/task_promoted/stdout.txt",
    stderrPath: "tasks/task_promoted/stderr.txt",
    logsPath: "tasks/task_promoted/events.jsonl",
    startedAt: "2026-09-27T09:00:00.000Z",
    updatedAt: "2026-09-27T09:02:00.000Z",
    origin: { kind: "agent_tool", toolCallId: "tool_1" },
    completion: {
      inject: true,
      entryId: "entry_task_notice",
      injectedAt: "2026-09-27T09:03:00.000Z",
      outputTailLineCount: 80,
    },
    visibility: "background",
  };
  // Non-promoted documents are filtered after decoding and need not satisfy
  // the current task schema during this targeted legacy conversion.
  const detachedTask = {
    id: "task_detached",
    completion: { inject: false },
  };
  const insert = database.prepare(
    `INSERT INTO domain_documents
     (namespace, scope_id, document_id, revision, payload_version, data,
      created_at_ms, updated_at_ms)
     VALUES ('task', 'global', ?, 1, 1, ?, 0, 0)`,
  );
  insert.run(promotedTask.id, encode(promotedTask));
  insert.run(detachedTask.id, encode(detachedTask));

  migrateLegacyAgentObligations(database);

  const rows = database
    .prepare(
      `SELECT id, state, notification_entry_id
       FROM agent_async_obligations ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      {
        id: "promoted_task:task_promoted:0",
        state: "consumed",
        notification_entry_id: "entry_task_notice",
      },
    ],
  );
  database.close();
});

test("historical restarted tasks discard inherited delivery state", () => {
  const database = databaseForMigration();
  const task = {
    id: "task_restarted",
    conversationId: "conv_1",
    agentId: "agent_lead",
    cwd: "/tmp",
    command: "serve",
    status: "cancelled",
    readiness: { outcome: "ready" },
    stdoutPath: "tasks/task_restarted/stdout.txt",
    stderrPath: "tasks/task_restarted/stderr.txt",
    logsPath: "tasks/task_restarted/events.jsonl",
    startedAt: "2026-09-27T10:01:00.000Z",
    updatedAt: "2026-09-27T10:02:00.000Z",
    finishedAt: "2026-09-27T10:02:00.000Z",
    restartedFromTaskId: "task_original",
    restartGeneration: 1,
    origin: { kind: "api" },
    completion: {
      inject: true,
      entryId: "entry_original_completion",
      injectedAt: "2026-09-27T10:00:30.000Z",
      outputTailLineCount: 80,
    },
    notifications: {
      enabled: true,
      ready: true,
      terminal: true,
      terminalEntryId: "entry_original_completion",
      terminalDeliveredAt: "2026-09-27T10:00:30.000Z",
      outputTailLineCount: 80,
    },
    visibility: "background",
  };
  database
    .prepare(
      `INSERT INTO domain_documents
       (namespace, scope_id, document_id, revision, payload_version, data,
        created_at_ms, updated_at_ms)
       VALUES ('task', 'global', ?, 1, 1, ?, 0, 0)`,
    )
    .run(task.id, encode(task));

  migrateLegacyAgentObligations(database);

  const row = database
    .prepare(
      `SELECT state, notification_entry_id, data
       FROM agent_async_obligations`,
    )
    .get() as {
    state: string;
    notification_entry_id: string;
    data: Uint8Array;
  };
  const obligation = decode(row.data) as Record<string, unknown>;
  assert.equal(row.state, "ready");
  assert.equal(row.notification_entry_id, "entry_task_restarted_completion");
  assert.equal(obligation.createdAt, task.startedAt);
  assert.equal(obligation.updatedAt, task.updatedAt);
  assert.equal("deliveredAt" in obligation, false);
  assert.equal("consumedAt" in obligation, false);
  database.close();
});
