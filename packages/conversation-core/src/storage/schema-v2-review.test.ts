import { test } from "node:test";
import assert from "node:assert/strict";
import { coreSchemaV1 } from "./schema.js";
import { coreSchemaV2 } from "./schema-v2.js";
// SQL text inspection only. Never open SQLite or execute these statements.
await test("D10 rebuild preserves the complete released conversation definition and exact indexes", () => {
  const original = coreSchemaV1.match(
    /CREATE TABLE conversation \([\s\S]*?\) STRICT;/,
  )![0];
  const replacement = coreSchemaV2.match(
    /CREATE TABLE conversation_new \([\s\S]*?\) STRICT;/,
  )![0];
  assert.equal(
    replacement
      .replace("conversation_new", "conversation")
      .replace("  working_directory TEXT NOT NULL,\n", ""),
    original,
  );
  for (const index of coreSchemaV1.matchAll(
    /CREATE (?:UNIQUE )?INDEX (?:conversation_project_parent_updated|conversation_parent|conversation_pinned|trusted_resource_project_path|trusted_resource_user_path)[^;]*;/g,
  ))
    assert(coreSchemaV2.includes(index[0]));
  assert(
    coreSchemaV2.includes(
      "cfg.working_directory\nFROM conversation c JOIN conversation_config cfg ON cfg.conversation_id=c.id;",
    ),
  );
  const columns = [...original.matchAll(/\b(\w+) (?:TEXT|INTEGER)\b/g)].map(
    (match) => match[1],
  );
  const copy = coreSchemaV2.match(
    /INSERT INTO conversation_new\s*\(([^)]+)\)\s*SELECT ([\s\S]*?)\nFROM/,
  )!;
  assert.deepEqual(
    copy[1].split(",").map((field) => field.trim()),
    [...columns, "working_directory"],
  );
  assert.deepEqual(
    copy[2].split(",").map((field) => field.trim()),
    [...columns.map((field) => `c.${field}`), "cfg.working_directory"],
  );
  assert.equal(
    [...coreSchemaV2.matchAll(/CREATE (?:UNIQUE )?INDEX /g)].length,
    5,
  );
  assert(
    coreSchemaV2.indexOf("INSERT INTO conversation_new") <
      coreSchemaV2.indexOf("DROP TABLE conversation_config"),
  );
  assert(
    coreSchemaV2.indexOf("DROP TABLE conversation;") <
      coreSchemaV2.indexOf(
        "ALTER TABLE conversation_new RENAME TO conversation;",
      ),
  );
  assert(!coreSchemaV2.includes("CREATE TABLE conversation_config"));
  assert(!coreSchemaV2.includes("CREATE TABLE conversation_config_new"));
});
