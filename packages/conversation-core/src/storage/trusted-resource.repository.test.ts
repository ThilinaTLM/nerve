import assert from "node:assert/strict";
import { test } from "node:test";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { openCoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";
import { TrustedResourceRepository } from "./trusted-resource.repository.js";

test("an extension decision with a grant snapshot of an older shape reads as no decision (not a decline) and is replaced by the next one", () => {
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

  assert.equal(repository.find("extension", null, "/ext/demo"), null);
  assert.equal(repository.list(null, "extension").length, 0);
  // The next decision replaces the row.
  const inserted = repository.insert({
    id: "t2",
    kind: "extension",
    projectId: null,
    resourceKey: "/ext/demo",
    name: "demo",
    contentDigest: digest,
    status: "trusted",
    grants: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(
    repository.find("extension", null, "/ext/demo")?.id,
    inserted.id,
  );
  assert.equal(repository.list(null, "extension").length, 1);
});
