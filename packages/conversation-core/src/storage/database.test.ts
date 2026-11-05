import assert from "node:assert/strict";
import test from "node:test";
import { openCoreDatabase } from "./database.js";

test("transaction rejects async callbacks and keeps the original error", () => {
  const db = openCoreDatabase(":memory:");
  try {
    db.sqlite.exec("CREATE TABLE t (v)");
    assert.throws(
      () =>
        db.transaction((() => {
          db.sqlite.exec("INSERT INTO t VALUES (1)");
          return Promise.resolve();
        }) as () => void),
      /synchronous/,
    );
    assert.equal(db.sqlite.prepare("SELECT count(*) c FROM t").get()?.c, 0);
    assert.throws(
      () =>
        db.transaction(() => {
          db.sqlite.exec("COMMIT");
          throw new Error("boom");
        }),
      /boom/,
    );
  } finally {
    db.close();
  }
});
