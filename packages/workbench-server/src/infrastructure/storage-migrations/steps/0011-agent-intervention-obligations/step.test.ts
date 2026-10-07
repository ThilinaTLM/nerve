import step from "./step.js";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";
import { CANONICAL_MIGRATIONS } from "../../../persistence/canonical-sqlite/schema.js";

void it("copied v7 obligation table widens intervention source constraint without changing original payloads, correlations, indexes or uniqueness", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-intervention-schema-"));
  const source = join(home, "v7.sqlite"),
    copied = join(home, "copied.sqlite");
  try {
    const original = new DatabaseSync(source);
    original.exec(
      CANONICAL_MIGRATIONS.find((migration) => migration.version === 7)!.sql,
    );
    const insert =
      "INSERT INTO agent_async_obligations VALUES (?, 'conv_test','agent_parent',?,'run_original','agent_child','ready','entry_original',4,1,?,10,20)";
    const payload = Buffer.from(
      '{"immutable":"original accepted notice","queueInputId":"input_original"}',
    );
    original
      .prepare(insert)
      .run("async_subagent:run_original:4", "async_subagent", payload);
    assert.throws(
      () =>
        original
          .prepare(insert)
          .run(
            "user_intervention:input_original:4",
            "user_intervention",
            payload,
          ),
      /CHECK/,
    );
    original.close();
    await copyFile(source, copied);
    const migrated = new DatabaseSync(copied);
    await step.run({ db: migrated } as never);
    await step.verify?.({ db: migrated } as never);
    const row = migrated
      .prepare("SELECT * FROM agent_async_obligations WHERE id=?")
      .get("async_subagent:run_original:4")!;
    assert.equal(row.generation, 4);
    assert.equal(row.notification_entry_id, "entry_original");
    assert.deepEqual(Buffer.from(row.data as Uint8Array), payload);
    assert.equal(row.created_at_ms, 10);
    assert.equal(row.updated_at_ms, 20);
    migrated
      .prepare(insert)
      .run("user_intervention:input_original:4", "user_intervention", payload);
    assert.throws(
      () =>
        migrated
          .prepare(insert)
          .run("different-id-same-source", "user_intervention", payload),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        migrated
          .prepare(insert)
          .run("untrusted-source", "forged_source", payload),
      /CHECK/,
    );
    assert.equal(
      migrated
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'agent_async_obligations_%'",
        )
        .get()!.n,
      3,
    );
    migrated.close();
    const restarted = new DatabaseSync(copied);
    assert.equal(
      restarted
        .prepare("SELECT count(*) AS n FROM agent_async_obligations")
        .get()!.n,
      2,
    );
    restarted.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
