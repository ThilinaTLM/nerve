import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveStorageCopyOptions } from "../storage-copy-options.js";

const repo = resolve("test-checkout");

test("copy defaults to the real home and slot 1", () => {
  const { source, slot } = resolveStorageCopyOptions([], repo);
  assert.equal(source, join(homedir(), ".nerve"));
  assert.equal(slot.slot, 1);
  assert.equal(slot.home, join(repo, "data", "storage-1"));
  const selected = resolveStorageCopyOptions(["--slot", "2"], repo);
  assert.equal(selected.source, source);
  assert.equal(selected.slot.home, join(repo, "data", "storage-2"));
});

test("copy accepts archival and numbered sources in either option order", () => {
  const archive = "data/storage-0-34-1-do-not-use";
  for (const args of [
    ["--from", archive, "--slot", "4"],
    ["--slot", "4", "--from", archive],
    ["--", "--from", archive, "--slot", "4"],
  ]) {
    const { source, slot } = resolveStorageCopyOptions(args, repo);
    assert.equal(source, resolve(archive));
    assert.equal(slot.home, join(repo, "data", "storage-4"));
  }
  const source = join(repo, "data", "storage-2");
  const selected = resolveStorageCopyOptions(["--from", source], repo);
  assert.equal(selected.source, source);
  assert.equal(selected.slot.slot, 1);
  assert.equal(
    resolveStorageCopyOptions(["--slot", "100"], repo).slot.slot,
    100,
  );
});

test("copy rejects malformed, duplicate, unknown, and invalid slot options", () => {
  for (const args of [
    ["--from"],
    ["--from", ""],
    ["--from", "--slot", "4"],
    ["--slot"],
    ["--from", "source", "--from", "other"],
    ["--slot", "2", "--slot", "3"],
    ["--to", "destination"],
    ["source"],
    ["--slot", "0"],
    ["--slot", "101"],
    ["--slot", "01"],
    ["--slot", "1.5"],
    ["--slot", "invalid"],
  ]) {
    assert.throws(() => resolveStorageCopyOptions(args, repo));
  }
});
