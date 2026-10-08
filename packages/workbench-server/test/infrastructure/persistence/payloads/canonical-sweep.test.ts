import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  assertPayloadDescriptorCoverage,
  decodeCanonicalPayloadRecords,
  inspectPayloadDescriptorCoverage,
  iterateCanonicalPayloadRecords,
} from "../../../../src/infrastructure/persistence/payloads/canonical-sweep.js";
import { createJsonPayloadCodec } from "../../../../src/infrastructure/persistence/payloads/codec.js";
import {
  payloadDescriptor,
  type PayloadDescriptor,
} from "../../../../src/infrastructure/persistence/payloads/descriptors.js";
import {
  CANONICAL_MIGRATIONS,
  CANONICAL_SCHEMA_SQL,
} from "../../../../src/infrastructure/persistence/canonical-sqlite/schema.js";
import { canonicalPayloadSweepDescriptors } from "../../../../src/infrastructure/storage-migrations/runner/payload-sweep.js";
import { sweepStorageReadability } from "../../../../src/infrastructure/storage-migrations/runner/sweep.js";

const testCodec = createJsonPayloadCodec({
  currentVersion: 1,
  read: (value) => value,
});

const testDescriptor: PayloadDescriptor = {
  id: "test-payload",
  location: { database: "canonical", table: "payloads", column: "data" },
  keyColumns: ["scope", "id"],
  recordClass: "derived",
  quarantineUnit: "record",
  version: { kind: "column", column: "payload_version" },
  codec: testCodec,
  validation: "json-only",
};

describe("canonical payload sweep adapter", () => {
  it("lazily reads and decodes descriptor rows without changing the database", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`CREATE TABLE payloads (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        payload_version INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY(scope, id)
      ) STRICT`);
      database
        .prepare("INSERT INTO payloads VALUES (?, ?, ?, ?)")
        .run("scope-a", "record-a", 1, Buffer.from('{"ok":true}'));
      const changesBefore = database
        .prepare("SELECT total_changes() AS value")
        .get() as { value: number };

      const records = [
        ...iterateCanonicalPayloadRecords(database, [testDescriptor]),
      ];
      assert.equal(records.length, 1);
      assert.equal(records[0]?.sourceKey, "scope-a/record-a");
      assert.deepEqual(records[0]?.key, {
        scope: "scope-a",
        id: "record-a",
      });
      assert.equal(records[0]?.bytes, 11);
      assert.deepEqual(
        [...decodeCanonicalPayloadRecords(database, [testDescriptor])].map(
          ({ value }) => value,
        ),
        [{ ok: true }],
      );

      const changesAfter = database
        .prepare("SELECT total_changes() AS value")
        .get() as { value: number };
      assert.equal(changesAfter.value, changesBefore.value);
    } finally {
      database.close();
    }
  });

  it("covers every non-null canonical payload BLOB in the current schema", () => {
    const database = currentCanonicalDatabase();
    try {
      assert.doesNotThrow(() => assertPayloadDescriptorCoverage(database));
      assert.deepEqual(
        sweepStorageReadability(database, canonicalPayloadSweepDescriptors())
          .failures,
        [],
      );
    } finally {
      database.close();
    }
  });

  it("reads populated run completions and delegation snapshots at startup without rewriting them", () => {
    const database = currentCanonicalDatabase();
    try {
      const completion = {
        agentId: "agent_child",
        runId: "run_one",
        attemptId: "exec_one",
        outcome: "completed",
        completedAt: "2026-10-08T00:00:00.000Z",
        response: {
          entryId: "entry_response",
          runId: "run_one",
          text: "Done",
          complete: true,
        },
        futureCompatibilityField: { preserve: true },
      };
      const delegation = {
        agentId: "agent_parent",
        configurationRevision: 1,
        configuration: {
          mode: "coding",
          permissionLevel: "read_only",
          thinkingLevel: "off",
          projectDir: "/tmp/project",
          workspaceScope: { roots: ["/tmp/project"] },
          instructions: "",
          tools: [],
          skills: [],
        },
        source: {
          runId: "run_parent",
          attemptId: "exec_parent",
          toolCallId: "tool_delegation",
        },
      };
      const documents = [
        ["agent-run-completion", completion],
        ["agent-delegation-input", delegation],
      ] as const;
      const insert = database.prepare(`INSERT INTO domain_documents
        (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
        VALUES (?, 'agent_child', 'one', 1, 1, ?, 0, 0)`);
      for (const [namespace, value] of documents)
        insert.run(namespace, Buffer.from(JSON.stringify(value)));
      const before = database.prepare("SELECT total_changes() AS value").get();
      assert.doesNotThrow(() => assertPayloadDescriptorCoverage(database));
      assert.deepEqual(
        sweepStorageReadability(database, canonicalPayloadSweepDescriptors())
          .failures,
        [],
      );
      const records = [...decodeCanonicalPayloadRecords(database)].filter(
        (record) =>
          documents.some(
            ([namespace]) => record.descriptor.location.namespace === namespace,
          ),
      );
      assert.equal(records.length, documents.length);
      for (const [namespace, value] of documents) {
        assert.deepEqual(
          records.find(
            (record) => record.descriptor.location.namespace === namespace,
          )?.value,
          value,
        );
        assert.equal(
          payloadDescriptor(`domain-document:${namespace}`)?.recordClass,
          "user-content",
        );
      }
      assert.deepEqual(
        database.prepare("SELECT total_changes() AS value").get(),
        before,
      );
      const invalid = {
        ...completion,
        response: { ...completion.response, runId: "run_other" },
      };
      database
        .prepare(
          "UPDATE domain_documents SET data = ? WHERE namespace = 'agent-run-completion'",
        )
        .run(Buffer.from(JSON.stringify(invalid)));
      const failures = sweepStorageReadability(
        database,
        canonicalPayloadSweepDescriptors(),
      ).failures;
      assert.equal(failures.length, 1);
      assert.match(failures[0]?.reason ?? "", /exact submitted run/);
    } finally {
      database.close();
    }
  });

  it("accepts registered additive payload owners when installed", () => {
    const database = currentCanonicalDatabase();
    try {
      database.exec(`
        CREATE TABLE artifact_manifests (
          manifest_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          data BLOB NOT NULL
        ) STRICT;
        CREATE TABLE exact_call_authorizations (
          authorization_id TEXT PRIMARY KEY,
          data BLOB NOT NULL
        ) STRICT;
        CREATE TABLE restore_promotions (
          restore_id TEXT PRIMARY KEY,
          data BLOB NOT NULL
        ) STRICT;
        CREATE TABLE transcript_projection_rows (
          conversation_id TEXT NOT NULL,
          source_revision INTEGER NOT NULL,
          entry_id TEXT NOT NULL,
          visibility_key TEXT NOT NULL,
          payload_version INTEGER NOT NULL,
          data BLOB NOT NULL,
          PRIMARY KEY(conversation_id, source_revision, entry_id, visibility_key)
        ) STRICT;
      `);
      database
        .prepare(
          `INSERT INTO domain_documents
            (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
           VALUES ('approval_settlement', 'global', 'one', 1, 1, ?, 0, 0)`,
        )
        .run(Buffer.from("{}"));

      assert.doesNotThrow(() => assertPayloadDescriptorCoverage(database));
    } finally {
      database.close();
    }
  });

  it("reports unregistered schema payloads and stored namespaces", () => {
    const database = currentCanonicalDatabase();
    try {
      database.exec(
        "CREATE TABLE unexpected_payloads (id TEXT PRIMARY KEY, data BLOB NOT NULL) STRICT",
      );
      database
        .prepare(
          `INSERT INTO domain_documents
            (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
           VALUES ('future_namespace', 'global', 'one', 1, 1, ?, 0, 0)`,
        )
        .run(Buffer.from("{}"));

      const coverage = inspectPayloadDescriptorCoverage(database);
      assert.deepEqual(coverage.unregisteredPayloadColumns, [
        "unexpected_payloads.data",
      ]);
      assert.deepEqual(coverage.unregisteredNamespaces, ["future_namespace"]);
      assert.throws(
        () => assertPayloadDescriptorCoverage(database),
        /unregistered payload column unexpected_payloads\.data.*unregistered domain namespace future_namespace/,
      );
    } finally {
      database.close();
    }
  });
});

function currentCanonicalDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(CANONICAL_SCHEMA_SQL);
  for (const migration of CANONICAL_MIGRATIONS) database.exec(migration.sql);
  return database;
}
