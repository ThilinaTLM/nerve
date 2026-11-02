import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  directoryPathsFromArgv,
  filterOpenPaths,
  OpenPathRequests,
} from "../src/ipc/open-path-requests.js";

test("filters OS requests to existing files/directories and argv to directories", () => {
  const root = mkdtempSync(join(tmpdir(), "nerve-open-paths-"));
  try {
    const folder = join(root, "a folder");
    const file = join(root, "file.txt");
    mkdirSync(folder);
    writeFileSync(file, "hello");
    assert.deepEqual(
      filterOpenPaths([folder, file, join(root, "missing"), "relative"]),
      [folder, file],
    );
    assert.deepEqual(
      directoryPathsFromArgv(
        ["--ignored", "a folder", "file.txt", "missing"],
        root,
      ),
      [folder],
    );
    assert.deepEqual(
      directoryPathsFromArgv(
        ["--host", "a folder", "--port=1", "a folder"],
        root,
      ),
      [folder],
    );
    assert.deepEqual(directoryPathsFromArgv(["--token", "a folder"], root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buffers startup requests, delivers once in order, and buffers while unsubscribed", () => {
  const queue = new OpenPathRequests();
  queue.enqueue([]);
  queue.enqueue(["first"]);
  queue.enqueue(["second", "third"]);
  const received: string[][] = [];
  const unsubscribe = queue.subscribe((paths) => received.push(paths));
  queue.enqueue(["live"]);
  assert.deepEqual(received, [["first"], ["second", "third"], ["live"]]);
  unsubscribe();
  queue.enqueue(["reload"]);
  queue.subscribe((paths) => received.push(paths));
  unsubscribe(); // A stale renderer cannot unsubscribe its replacement.
  queue.enqueue(["replacement"]);
  assert.deepEqual(received.slice(3), [["reload"], ["replacement"]]);
});
