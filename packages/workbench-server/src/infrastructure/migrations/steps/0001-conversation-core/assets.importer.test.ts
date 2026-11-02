import assert from "node:assert/strict";
import { readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../../framework/runner.js";
import { fixture, registry } from "./step-fixture.js";

void test("missing, unsafe and linked assets preserve their descriptors without blocking conversations", async (t) => {
  const home = await fixture(t);
  try {
    await symlink(
      join(home, "..", "outside-home", "not-readable"),
      join(home, "data/conversations/one/linked.txt"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  for (const [id, path] of [
    ["missing", "conversations/one/missing.txt"],
    ["unsafe", "../outside"],
    ["linked", "conversations/one/linked.txt"],
  ])
    db.prepare(
      "INSERT INTO file_assets VALUES (?, 'conv_one', NULL, ?, 'report', 0, NULL, NULL, 0)",
    ).run(id, path);
  db.close();
  await runMigrations(home, { registry });
  const root = join(home, "quarantine/0001-conversation-core");
  const reasons = await Promise.all(
    (await readdir(root)).map(async (name) => ({
      path: join(root, name),
      value: JSON.parse(
        await readFile(join(root, name, "reason.json"), "utf8"),
      ),
    })),
  );
  for (const id of ["missing", "unsafe", "linked"]) {
    const item = reasons.find(
      (item) => item.value.id === `conv_one/asset/${id}`,
    )!;
    assert.ok(item);
    assert(
      (
        await readFile(join(item.path, "payload/records.jsonl"), "utf8")
      ).includes(`"id":"${id}"`),
    );
  }
  const report = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  assert(
    report.losses.some(
      (loss: { reason: string }) => loss.reason === "Unsafe asset path",
    ),
  );
  assert(
    report.losses.some(
      (loss: { reason: string }) => loss.reason === "Linked or non-file asset",
    ),
  );
});
