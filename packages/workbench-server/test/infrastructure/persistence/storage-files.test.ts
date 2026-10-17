import assert from "node:assert/strict";
import fs, {
  link,
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, mock } from "node:test";
import {
  dirSize,
  scanDirectoryUsage,
} from "../../../src/domains/storage/storage-files.js";

it("reuses a single traversal for logical path sizes, owners and root files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-scan-"));
  try {
    await mkdir(join(root, "owner", "excluded"), { recursive: true });
    await mkdir(join(root, "empty"));
    await mkdir(join(root, "excluded"));
    await writeFile(join(root, "excluded", "hidden"), "ignored");
    await writeFile(join(root, "owner", "excluded", "kept"), "123");
    await writeFile(join(root, "root-file"), "12345");
    await writeFile(join(root, "zero"), "");
    await link(join(root, "root-file"), join(root, "owner", "hardlink"));
    await symlink(join(root, "owner"), join(root, "linked-owner"));
    await symlink(join(root, "root-file"), join(root, "linked-file"));
    const sparse = await open(join(root, "owner", "sparse"), "w");
    await sparse.truncate(1024 * 1024);
    await sparse.close();
    const scan = await scanDirectoryUsage(root, new Set(["excluded"]));
    assert.equal(scan.bytes, 1024 * 1024 + 13);
    assert.equal(scan.files, 5);
    assert.deepEqual([...scan.directories.keys()].sort(), ["empty", "owner"]);
    assert.deepEqual(scan.directories.get("empty"), { bytes: 0, files: 0 });
    assert.deepEqual(scan.directories.get("owner"), {
      bytes: 1024 * 1024 + 8,
      files: 3,
    });
    assert.deepEqual(
      scan.rootFiles,
      new Map([
        ["root-file", 5],
        ["zero", 0],
      ]),
    );
    assert.deepEqual(await dirSize(root, new Set(["excluded"])), {
      bytes: scan.bytes,
      files: scan.files,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("tolerates unreadable directories and disappearing or replaced files", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-scan-errors-"));
  const originalRead = fs.readdir;
  const originalStat = fs.lstat;
  await mkdir(join(root, "unreadable"));
  await writeFile(join(root, "vanished"), "123");
  await writeFile(join(root, "replaced"), "123");
  const reader = mock.method(
    fs,
    "readdir",
    async (...args: Parameters<typeof originalRead>) => {
      if (args[0] === join(root, "unreadable")) throw new Error("EACCES");
      return originalRead(...args);
    },
  );
  const stat = mock.method(
    fs,
    "lstat",
    async (...args: Parameters<typeof originalStat>) => {
      if (args[0] === join(root, "vanished")) throw new Error("ENOENT");
      if (args[0] === join(root, "replaced")) {
        await rm(join(root, "replaced"));
        await symlink(join(root, "vanished"), join(root, "replaced"));
      }
      return originalStat(...args);
    },
  );
  syncBuiltinESMExports();
  try {
    const scan = await scanDirectoryUsage(root);
    assert.equal(scan.bytes, 0);
    assert.equal(scan.files, 0);
    assert.deepEqual(scan.directories.get("unreadable"), {
      bytes: 0,
      files: 0,
    });
    assert.equal(scan.rootFiles.has("vanished"), true);
    assert.equal(scan.rootFiles.get("vanished"), undefined);
    assert.equal(scan.rootFiles.get("replaced"), undefined);
    assert.equal((await scanDirectoryUsage(join(root, "missing"))).bytes, 0);
  } finally {
    reader.mock.restore();
    stat.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
