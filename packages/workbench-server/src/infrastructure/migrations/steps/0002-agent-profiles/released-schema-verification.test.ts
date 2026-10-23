import { test } from "node:test";
import assert from "node:assert/strict";
import { coreMigrations } from "@nervekit/conversation-core";
import { verifyConvertedTableSql } from "./released-schema-verification.js";

// Released/reviewed SQL text only. No SQLite fixture, handles or DDL execution.
const originalSql = coreMigrations.find(
  (migration) => migration.version === 1,
)!.sql;
const reviewed = coreMigrations.find(
  (migration) => migration.version === 2,
)!.sql;
const original = [
  ...originalSql.matchAll(/CREATE TABLE (\w+) \([\s\S]*?\) STRICT;/g),
].map((match) => ({ name: match[1], sql: match[0] }));
function converted() {
  return original
    .filter((table) => table.name !== "conversation_config")
    .map((table) => {
      if (table.name !== "conversation" && table.name !== "trusted_resource")
        return { ...table };
      const statement = reviewed.match(
        new RegExp(`CREATE TABLE ${table.name}_new \\([\\s\\S]*?\\) STRICT;`),
      )![0];
      return {
        name: table.name,
        sql: statement.replace(`${table.name}_new`, `"${table.name}"`),
      };
    });
}

await test("converted sqlite_master definitions preserve reviewed conversation deferral and original inbound table SQL", () => {
  verifyConvertedTableSql(converted(), original, reviewed);
  const formatting = converted().map((table) => ({
    ...table,
    sql: table.sql.replaceAll("\n", "\n  "),
  }));
  verifyConvertedTableSql(formatting, original, reviewed);
  const changed = converted();
  changed.find((table) => table.name === "conversation")!.sql = changed
    .find((table) => table.name === "conversation")!
    .sql.replace(" DEFERRABLE INITIALLY DEFERRED", "");
  assert.throws(
    () => verifyConvertedTableSql(changed, original, reviewed),
    /table SQL changed: conversation/,
  );
});

await test("every inbound FK table retains deferral and targets even when foreign_key_list would be unchanged", () => {
  const inbound = original.filter(
    (table) =>
      table.name !== "conversation_config" &&
      table.name !== "conversation" &&
      table.sql.includes("REFERENCES conversation("),
  );
  assert.deepEqual(inbound.map((table) => table.name).sort(), [
    "asset",
    "async_bash",
    "conversation_event",
    "input_queue",
    "tool_call",
  ]);
  for (const source of inbound) {
    for (const change of [
      (sql: string) =>
        sql.replace(
          "REFERENCES conversation(id) ON DELETE CASCADE",
          "REFERENCES conversation(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED",
        ),
      (sql: string) =>
        sql.replace(
          "REFERENCES conversation(id)",
          "REFERENCES retired_conversation(id)",
        ),
      (sql: string) =>
        sql.replace("REFERENCES conversation(id) ON DELETE CASCADE", ""),
    ]) {
      const changed = converted();
      const table = changed.find((table) => table.name === source.name)!;
      const before = table.sql;
      table.sql = change(before);
      assert.notEqual(table.sql, before);
      assert.throws(
        () => verifyConvertedTableSql(changed, original, reviewed),
        new RegExp(`table SQL changed: ${source.name}`),
      );
    }
  }
});

await test("schema normalization cannot hide changed CHECK literals or an unexpected table set", () => {
  const changed = converted();
  const conversation = changed.find((table) => table.name === "conversation")!;
  conversation.sql = conversation.sql.replace("'running'", "'running '");
  assert.throws(
    () => verifyConvertedTableSql(changed, original, reviewed),
    /table SQL changed: conversation/,
  );
  assert.throws(
    () =>
      verifyConvertedTableSql(
        [
          ...converted(),
          original.find((table) => table.name === "conversation_config")!,
        ],
        original,
        reviewed,
      ),
    /table set/,
  );
});

await test("comment normalization cannot hide a deferred inbound FK becoming immediate", () => {
  const inbound = {
    name: "inbound",
    sql: "CREATE TABLE inbound (\n id TEXT REFERENCES conversation(id) -- reference\n DEFERRABLE INITIALLY DEFERRED\n) STRICT;",
  };
  const source = [...original, inbound];
  const current = [...converted(), { ...inbound }];
  verifyConvertedTableSql(current, source, reviewed);
  current.at(-1)!.sql = inbound.sql.replace(
    "-- reference\n DEFERRABLE INITIALLY DEFERRED\n",
    "-- reference DEFERRABLE INITIALLY DEFERRED\n",
  );
  assert.throws(
    () => verifyConvertedTableSql(current, source, reviewed),
    /table SQL changed: inbound/,
  );
});
