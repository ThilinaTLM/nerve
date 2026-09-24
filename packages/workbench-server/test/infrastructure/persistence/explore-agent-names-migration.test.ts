import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  CANONICAL_MIGRATIONS,
  CANONICAL_SCHEMA_SQL,
} from "../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

const migration = CANONICAL_MIGRATIONS.find(
  (candidate) => candidate.name === "explore-agent-names-v6",
);

function blob(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function insertAgent(
  database: DatabaseSync,
  agent: Record<string, unknown> & { id: string },
) {
  database
    .prepare(
      `INSERT INTO domain_documents
         (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
       VALUES ('agent', 'global', ?, 1, 1, ?, 0, 0)`,
    )
    .run(agent.id, blob({ conversationId: "conv_1", ...agent }));
}

function insertToolCall(
  database: DatabaseSync,
  sequence: number,
  data: Record<string, unknown>,
) {
  database
    .prepare(
      `INSERT INTO conversation_records
         (id, conversation_id, agent_id, sequence, revision, kind, status, payload_version, data, created_at_ms, updated_at_ms)
       VALUES (?, 'conv_1', ?, ?, 1, 'tool_call', 'completed', 1, ?, 0, 0)`,
    )
    .run(`tool_${sequence}`, data.agentId as string, sequence, blob(data));
}

function agentDocument(database: DatabaseSync, id: string) {
  const row = database
    .prepare(
      `SELECT data, revision FROM domain_documents
       WHERE namespace = 'agent' AND document_id = ?`,
    )
    .get(id) as { data: Uint8Array; revision: number };
  assert.ok(row.data instanceof Uint8Array, "agent data stays a BLOB");
  return {
    revision: row.revision,
    data: JSON.parse(Buffer.from(row.data).toString("utf8")) as Record<
      string,
      unknown
    >,
  };
}

test("names older explore agents from their parent's explore labels", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  database.exec(CANONICAL_SCHEMA_SQL);

  insertAgent(database, { id: "agent_lead" });
  insertAgent(database, {
    id: "agent_storage",
    parentAgentId: "agent_lead",
    task: "Trace storage migrations and journal layout",
  });
  insertAgent(database, {
    id: "agent_unlabeled",
    parentAgentId: "agent_lead",
    task: "Inspect timeline cards without any label",
  });
  insertAgent(database, {
    id: "agent_mate",
    parentAgentId: "agent_lead",
    executionKind: "async_developer",
    name: "server-kinds",
    task: "Trace storage migrations and journal layout",
  });
  insertToolCall(database, 1, {
    agentId: "agent_lead",
    toolName: "explore",
    args: {
      tasks: [
        {
          task: "  Trace storage migrations and journal layout ",
          label: " Storage and migrations ",
        },
        { task: "Inspect timeline cards without any label" },
      ],
    },
  });
  insertToolCall(database, 2, {
    agentId: "agent_lead",
    toolName: "read",
    args: {
      tasks: [
        { task: "Inspect timeline cards without any label", label: "Wrong" },
      ],
    },
  });

  database.exec(migration.sql);

  const storage = agentDocument(database, "agent_storage");
  assert.equal(storage.data.name, "Storage and migrations");
  assert.equal(storage.data.executionKind, "explore");
  assert.equal(storage.revision, 2);

  const unlabeled = agentDocument(database, "agent_unlabeled");
  assert.equal(unlabeled.data.name, undefined);
  assert.equal(unlabeled.revision, 1);

  const mate = agentDocument(database, "agent_mate");
  assert.equal(mate.data.name, "server-kinds");
  assert.equal(mate.revision, 1);

  assert.equal(agentDocument(database, "agent_lead").revision, 1);
  database.close();
});
