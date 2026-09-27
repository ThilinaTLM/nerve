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
import type { PayloadDescriptor } from "../../../../src/infrastructure/persistence/payloads/descriptors.js";
import {
  CANONICAL_MIGRATIONS,
  CANONICAL_SCHEMA_SQL,
} from "../../../../src/infrastructure/persistence/canonical-sqlite/schema.js";

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
