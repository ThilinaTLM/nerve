import assert from "node:assert/strict";
import { test } from "node:test";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { openCoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";
import { TrustedResourceRepository } from "./trusted-resource.repository.js";

test("an extension decision with a grant snapshot of an older shape is read as rejected and can be replaced", () => {
  const db = openCoreDatabase(":memory:");
  migrate(db);
  const repository = new TrustedResourceRepository(db);
  const digest = toTrustedDigest("a".repeat(64));
  // A snapshot from before `capabilities` became `models` and `frame`.
  const old = JSON.stringify({
    network: [],
    capabilities: ["models.vision"],
    accounts: [],
    namespaces: {},
    tools: [],
    ui: [],
  });
  db.sqlite
    .prepare(
      "INSERT INTO trusted_resource VALUES ('t1', 'extension', NULL, '/ext/demo', 'demo', ?, 'trusted', ?, 'now', 'now')",
    )
    .run(digest, old);
  // `now` is not a timestamp either; keep the row valid apart from its grants.
  db.sqlite.exec(
    "UPDATE trusted_resource SET created_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01T00:00:00.000Z'",
  );

  const found = repository.find("extension", null, "/ext/demo");
  assert.equal(found?.status, "rejected");
  assert.equal(found?.grants, null);
  assert.equal(repository.list(null, "extension").length, 1);
  // The next decision updates the row.
  const updated = repository.update("t1", { status: "trusted" });
  assert.equal(updated.status, "trusted");
});
