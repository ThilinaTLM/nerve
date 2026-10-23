import { test } from "node:test";
import assert from "node:assert/strict";
import {
  preserveDatabaseBackup,
  verifyDatabaseBackup,
  type DatabaseBackupIO,
} from "./released-backup.js";
import { sha256 } from "./released-format.js";
const input = {
  receiptPath: "/archive/receipt",
  target: "/archive/original.db",
  planDigest: sha256("plan"),
  temporary: () => "/archive/original.db.owned.tmp",
};
function fixture() {
  const files = new Map<string, string | Uint8Array>();
  let copies = 0,
    fail = "";
  const stage = (name: string) => {
    if (fail === name) {
      fail = "";
      throw new Error(name);
    }
  };
  const io: DatabaseBackupIO = {
    read: (path) => files.get(path),
    write(path, bytes) {
      files.set(path, bytes);
      stage(JSON.parse(bytes).phase);
    },
    remove(path) {
      files.delete(path);
    },
    async snapshot(path) {
      copies++;
      files.set(path, "partial");
      stage("copy");
      files.set(path, new Uint8Array([1, 2, 3, 4]));
    },
    sync() {
      stage("sync");
    },
    install(temporary, target) {
      files.set(target, files.get(temporary)!);
      files.delete(temporary);
      stage("install");
    },
  };
  return {
    io,
    files,
    copies: () => copies,
    fail: (name: string) => {
      fail = name;
    },
  };
}
await test("database snapshot resumes after intent/copy/fsync/ready/rename interruptions", async () => {
  for (const point of ["planned", "copy", "sync", "ready", "install"]) {
    const f = fixture();
    f.fail(point);
    await assert.rejects(
      preserveDatabaseBackup(f.io, input),
      new RegExp(point),
    );
    await preserveDatabaseBackup(f.io, input);
    verifyDatabaseBackup(
      f.io,
      input.receiptPath,
      input.target,
      input.planDigest,
    );
    assert.deepEqual(f.files.get(input.target), new Uint8Array([1, 2, 3, 4]));
    if (["ready", "install"].includes(point)) assert.equal(f.copies(), 1);
  }
});
await test("snapshot ownership, plan binding and bytes are verified, never inferred from an existing final", async () => {
  const collision = fixture();
  collision.files.set(input.target, new Uint8Array([1, 2, 3, 4]));
  await assert.rejects(
    preserveDatabaseBackup(collision.io, input),
    /collision/,
  );
  assert.equal(collision.copies(), 0);
  const f = fixture();
  await preserveDatabaseBackup(f.io, input);
  await assert.rejects(
    preserveDatabaseBackup(f.io, { ...input, planDigest: sha256("another") }),
    /another plan/,
  );
  f.files.set(input.target, "later edit");
  assert.throws(
    () =>
      verifyDatabaseBackup(
        f.io,
        input.receiptPath,
        input.target,
        input.planDigest,
      ),
    /changed/,
  );
});
