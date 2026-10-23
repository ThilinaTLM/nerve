import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeReleasedMigration,
  retireReleasedSources,
  type MigrationBackend,
} from "./released-executor.js";
import type { ExportReceipt } from "./released-export.js";
function fixture() {
  let state: "released" | "converted" = "released",
    transaction = false,
    backup = false;
  const calls: string[] = [],
    retired = new Set<string>();
  let fail = "",
    fileFailure = false,
    committedReceipts = 0;
  const stage = (name: string) => {
    calls.push(name);
    if (fail === name) {
      fail = "";
      throw new Error(name);
    }
  };
  const db: MigrationBackend = {
    state: () => state,
    async preserveDatabase() {
      stage("backup");
      backup = true;
    },
    verifyBackup() {
      stage("verify-backup");
      assert(backup);
    },
    verifyReleased() {
      stage("released");
      assert.equal(state, "released");
    },
    verifyConverted() {
      stage("converted");
      assert.equal(state, "converted");
    },
    begin() {
      stage("begin");
      transaction = true;
    },
    metadata() {
      stage("metadata");
    },
    rebuild() {
      stage("rebuild");
      state = "converted";
    },
    trust() {
      stage("trust");
    },
    recordVersion() {
      stage("version");
    },
    foreignKeys() {
      stage("foreign-keys");
    },
    commit() {
      stage("commit");
      transaction = false;
    },
    rollback() {
      calls.push("rollback");
      if (transaction) state = "released";
      transaction = false;
    },
  };
  const files = {
    receipts: [{ identity: "one" }, { identity: "two" }] as ExportReceipt[],
    verifyFiles() {
      stage("files");
      if (fileFailure) throw new Error("changed candidate");
    },
    committed() {
      stage("receipt");
      committedReceipts++;
    },
    retire(receipt: ExportReceipt) {
      if (!retired.has(receipt.identity)) retired.add(receipt.identity);
      stage("retire-" + receipt.identity);
    },
  };
  return {
    db,
    files,
    calls,
    retired,
    setFailure: (value: string) => {
      fail = value;
    },
    corruptFiles: () => {
      fileFailure = true;
    },
    state: () => state,
    receipts: () => committedReceipts,
  };
}
await test("backup and final source/file verification precede rebuild, trust/version/FK checks precede commit", async () => {
  const f = fixture();
  await executeReleasedMigration(f.db, f.files);
  assert.deepEqual(f.calls, [
    "files",
    "released",
    "backup",
    "verify-backup",
    "begin",
    "released",
    "files",
    "metadata",
    "rebuild",
    "trust",
    "version",
    "foreign-keys",
    "converted",
    "commit",
    "receipt",
  ]);
  assert.equal(f.retired.size, 0);
  await retireReleasedSources(f.files);
  assert.equal(f.retired.size, 2);
});
await test("interruption at every precommit stage cannot complete destructive migration", async () => {
  for (const point of [
    "released",
    "backup",
    "verify-backup",
    "begin",
    "metadata",
    "rebuild",
    "trust",
    "version",
    "foreign-keys",
    "converted",
    "commit",
  ]) {
    const f = fixture();
    f.setFailure(point);
    await assert.rejects(
      executeReleasedMigration(f.db, f.files),
      new RegExp(point),
    );
    assert.equal(f.state(), "released", point);
    assert.equal(f.receipts(), 0);
    assert.equal(f.retired.size, 0);
    await executeReleasedMigration(f.db, f.files);
    assert.equal(f.state(), "converted");
  }
});
await test("crash after DB commit resumes from converted state without exports, backup or DDL replay", async () => {
  const f = fixture();
  f.setFailure("receipt");
  await assert.rejects(executeReleasedMigration(f.db, f.files), /receipt/);
  assert.equal(f.state(), "converted");
  assert(!f.calls.includes("rollback"));
  const before = f.calls.length;
  await executeReleasedMigration(f.db, f.files);
  assert.deepEqual(f.calls.slice(before), [
    "files",
    "verify-backup",
    "converted",
    "receipt",
  ]);
  f.setFailure("retire-one");
  await assert.rejects(() => retireReleasedSources(f.files), /retire-one/);
  await retireReleasedSources(f.files);
  assert.equal(f.retired.size, 2);
});
await test("changed candidates block both initial execution and postcommit resume", async () => {
  const first = fixture();
  first.corruptFiles();
  await assert.rejects(
    executeReleasedMigration(first.db, first.files),
    /changed candidate/,
  );
  assert(!first.calls.includes("begin"));
  const resumed = fixture();
  await executeReleasedMigration(resumed.db, resumed.files);
  resumed.corruptFiles();
  const before = resumed.calls.length;
  await assert.rejects(
    executeReleasedMigration(resumed.db, resumed.files),
    /changed candidate/,
  );
  assert.deepEqual(resumed.calls.slice(before), ["files"]);
});

await test("phase labels precede long database operations and asynchronous verification finishes before commit", async () => {
  const f = fixture();
  const verifyReleased = f.db.verifyReleased.bind(f.db);
  const verifyConverted = f.db.verifyConverted.bind(f.db);
  const verifyFiles = f.files.verifyFiles.bind(f.files);
  const retire = f.files.retire.bind(f.files);
  f.db.verifyReleased = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await verifyReleased();
  };
  f.db.verifyConverted = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await verifyConverted();
  };
  const files = {
    ...f.files,
    async verifyFiles() {
      await new Promise<void>((resolve) => setImmediate(resolve));
      verifyFiles();
    },
    async retire(receipt: ExportReceipt) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      retire(receipt);
    },
  };
  await executeReleasedMigration(f.db, files, async (phase, label) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.calls.push(`${phase}: ${label}`);
  });
  assert.deepEqual(f.calls, [
    "files",
    "released",
    "backup: Backing up database",
    "backup",
    "verify-backup: Checking database backup",
    "verify-backup",
    "begin",
    "released",
    "files",
    "update-database: Updating database",
    "metadata",
    "rebuild",
    "trust",
    "version",
    "foreign-keys",
    "converted",
    "commit",
    "receipt",
  ]);
  await retireReleasedSources(files);
  assert.deepEqual(f.calls.slice(-3), ["files", "retire-one", "retire-two"]);
});
