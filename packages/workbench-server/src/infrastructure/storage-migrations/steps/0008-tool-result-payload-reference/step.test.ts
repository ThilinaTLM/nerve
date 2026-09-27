import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { checksumJsonV1 } from "../../kit/json/v1.js";
import step from "./step.js";
import { legacyToolResultPayloadReferenceV1 } from "./shapes.js";

void test("accepts the frozen legacy reference and preserves its identity", () => {
  const value = legacyToolResultPayloadReferenceV1({
    version: 1,
    kind: "tool_result",
    conversationId: "conv_a",
    toolCallId: "tool_b",
    logicalPath: "payloads/conversations/conv_a/tool-calls/tool_b/result.json",
    digest: "a".repeat(64),
    byteLength: 4,
    mediaType: "application/json",
    encoding: "utf-8",
    completeness: "complete",
    future: true,
  });
  assert.equal(value.toolCallId, "tool_b");
});

void test("migrates reordered references while ignoring malformed JSON rows", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE domain_documents (
    namespace TEXT, scope_id TEXT, document_id TEXT, revision INTEGER,
    payload_version INTEGER, data BLOB, created_at_ms INTEGER, updated_at_ms INTEGER
  );
  CREATE TABLE conversation_records (id TEXT PRIMARY KEY, data BLOB);
  CREATE TABLE conversation_record_projections (record_id TEXT PRIMARY KEY, data BLOB);
  CREATE TABLE durable_events (row_id INTEGER PRIMARY KEY, data BLOB);
  CREATE TABLE rpc_idempotency (outcome BLOB);
  CREATE TABLE file_assets (
    id TEXT PRIMARY KEY, category TEXT, conversation_id TEXT,
    tool_call_id TEXT, logical_path TEXT, updated_at_ms INTEGER
  );`);
  const oldPath = "payloads/conversations/conv_a/tool-calls/tool_b/result.json";
  const reference = {
    kind: "tool_result",
    version: 1,
    conversationId: "conv_a",
    toolCallId: "tool_b",
    logicalPath: oldPath,
    digest: "a".repeat(64),
    byteLength: 2,
    mediaType: "application/json",
    encoding: "utf-8",
    completeness: "complete",
  };
  db.prepare("INSERT INTO conversation_records VALUES (?, ?)").run(
    "valid",
    new TextEncoder().encode(
      JSON.stringify({ toolCall: { resultPayload: reference } }),
    ),
  );
  db.prepare("INSERT INTO conversation_records VALUES (?, ?)").run(
    "hostile",
    new TextEncoder().encode('{"kind":"tool_result"'),
  );
  db.prepare(
    "INSERT INTO domain_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "other",
    "global",
    "hostile",
    1,
    1,
    new TextEncoder().encode('{"kind":"tool_result"'),
    0,
    0,
  );
  const idempotencyCommit = { events: [{ payload: reference }] };
  db.prepare(
    "INSERT INTO domain_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "conversation_state",
    "conv_a",
    "state",
    1,
    1,
    new TextEncoder().encode(
      JSON.stringify({
        conversationId: "conv_a",
        revision: 1,
        idempotencyKeys: [
          [
            "request",
            {
              ...idempotencyCommit,
              checksum: checksumJsonV1(idempotencyCommit),
            },
          ],
        ],
      }),
    ),
    0,
    0,
  );
  const assetOnlyPath =
    "payloads/conversations/conv_asset/tool-calls/tool_asset/result.json";
  db.prepare("INSERT INTO file_assets VALUES (?, ?, ?, ?, ?, ?)").run(
    "asset",
    "payload",
    "conv_asset",
    "tool_asset",
    assetOnlyPath,
    0,
  );
  const source = new TextEncoder().encode("{}");
  const created = new Map<string, Uint8Array>();
  const files = {
    async read(path: string) {
      return path === `data/${oldPath}` ||
        path === `data/${assetOnlyPath}` ||
        path ===
          "data/payloads/conversations/conv_orphan/tool-calls/tool_orphan/result.json"
        ? source
        : undefined;
    },
    async create(path: string, bytes: Uint8Array) {
      created.set(path, bytes);
    },
    async list(path: string) {
      if (path === "data/payloads/conversations") return ["conv_orphan"];
      if (path === "data/payloads/conversations/conv_orphan/tool-calls")
        return ["tool_orphan"];
      return [];
    },
    async exists() {
      return false;
    },
    async sha256() {
      return "unused";
    },
  };
  await step.run({ db, files, nowMs: 1 } as never);
  await step.verify?.({ db, files, nowMs: 1 } as never);
  const row = db
    .prepare("SELECT data FROM conversation_records WHERE id = 'valid'")
    .get() as { data: Uint8Array };
  const migrated = JSON.parse(new TextDecoder().decode(row.data)) as {
    toolCall: { resultPayload: { version: number; logicalPath: string } };
  };
  assert.equal(migrated.toolCall.resultPayload.version, 2);
  assert.equal(
    migrated.toolCall.resultPayload.logicalPath,
    "conversations/a/tool-calls/b/result.json",
  );
  assert.ok(created.has("data/conversations/a/tool-calls/b/result.json"));
  assert.ok(
    created.has("data/conversations/asset/tool-calls/asset/result.json"),
  );
  assert.ok(
    created.has("data/conversations/orphan/tool-calls/orphan/result.json"),
  );
  assert.equal(
    (
      db
        .prepare("SELECT logical_path FROM file_assets WHERE id = 'asset'")
        .get() as {
        logical_path: string;
      }
    ).logical_path,
    "conversations/asset/tool-calls/asset/result.json",
  );
  const snapshotRow = db
    .prepare(
      "SELECT data FROM domain_documents WHERE namespace = 'conversation_state'",
    )
    .get() as { data: Uint8Array };
  const snapshot = JSON.parse(new TextDecoder().decode(snapshotRow.data)) as {
    idempotencyKeys: Array<
      [
        string,
        { checksum: string; events: Array<{ payload: { version: number } }> },
      ]
    >;
  };
  assert.equal(snapshot.idempotencyKeys[0]?.[1].events[0]?.payload.version, 2);
  assert.equal(
    snapshot.idempotencyKeys[0]?.[1].checksum,
    checksumJsonV1({ events: snapshot.idempotencyKeys[0]?.[1].events ?? [] }),
  );
  db.close();
});
