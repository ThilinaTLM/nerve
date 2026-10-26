import assert from "node:assert/strict";
import { test } from "node:test";
import { openCoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";

// A fresh database exercises the canonical schema, not a previously migrated server copy.
test("fresh core schema accepts agent-profile trust and rejects its retired kind", () => {
  const db = openCoreDatabase(":memory:");
  try {
    migrate(db);
    const insert = db.sqlite.prepare(`INSERT INTO trusted_resource
      (id, kind, project_id, path, name, content_digest, status, created_at, updated_at)
      VALUES (?, ?, NULL, '/profiles/coding', 'coding', 'digest', 'trusted', 'now', 'now')`);
    insert.run("new-profile", "agent_profile");
    assert.equal(
      db.sqlite
        .prepare("SELECT kind FROM trusted_resource WHERE id = ?")
        .get("new-profile")?.kind,
      "agent_profile",
    );
    assert.throws(
      () => insert.run("old-profile", "subagent_profile"),
      /CHECK constraint failed/,
    );
    migrate(db); // The persisted checksum must agree on reopen/recheck.
  } finally {
    db.close();
  }
});
