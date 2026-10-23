import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginMigrationArchive,
  currentMigrationArchive,
  finishMigrationArchive,
  type ArchiveIO,
} from "./released-archive.js";

await test("retry/resume uses one attempt; explicit rollback creates a fresh archive without deleting originals", () => {
  const files = new Map<string, string>();
  const io: ArchiveIO = {
    read: (path) => files.get(path),
    write: (path, bytes) => {
      files.set(path, bytes);
    },
  };
  const first = beginMigrationArchive("/home", io, () => "attempt-a");
  files.set(first + "/original", "exact original");
  assert.equal(
    beginMigrationArchive("/home", io, () => "must-not-be-used"),
    first,
  );
  finishMigrationArchive("/home", first, "rolled-back", io);
  const next = beginMigrationArchive("/home", io, () => "attempt-b");
  assert.notEqual(next, first);
  assert.equal(files.get(first + "/original"), "exact original");
  assert.equal(currentMigrationArchive("/home", io)?.state, "active");
});
await test("post-verification recovery resumes the committed attempt and cannot silently roll it back", () => {
  const files = new Map<string, string>();
  const io: ArchiveIO = {
    read: (path) => files.get(path),
    write: (path, bytes) => {
      files.set(path, bytes);
    },
  };
  const directory = beginMigrationArchive("/home", io, () => "attempt");
  finishMigrationArchive("/home", directory, "committed", io);
  assert.equal(
    beginMigrationArchive("/home", io, () => "other"),
    directory,
  );
  assert.throws(
    () => finishMigrationArchive("/home", directory, "rolled-back", io),
    /cannot be rolled back/,
  );
});
