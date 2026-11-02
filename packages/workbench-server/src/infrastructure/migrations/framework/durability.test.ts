import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renameWithRetrySync, syncDirectory, syncFile } from "./durability.js";
import { RollbackJournal, restoreSymlink } from "./rollback-journal.js";

const posixOnly = { skip: process.platform === "win32" };

function directory(t: test.TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "nerve-durability-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

void test("POSIX syncs read-only files and directories", posixOnly, (t) => {
  const root = directory(t);
  const file = join(root, "readonly.json");
  writeFileSync(file, "{}", { mode: 0o444 });
  assert.doesNotThrow(() => syncFile(file));
  assert.doesNotThrow(() => syncDirectory(root));
});

void test(
  "win32 syncFile opens for write and skips read-only-attribute files",
  posixOnly,
  (t) => {
    const root = directory(t);
    const file = join(root, "config.json");
    writeFileSync(file, "{}");
    const flags: unknown[] = [];
    const open = ((path: string, flag: string) => {
      flags.push(flag);
      return openThrowing(path, flag);
    }) as never;
    let openThrowing: (path: string, flag: string) => number = () => {
      throw errno("EPERM");
    };
    chmodSync(file, 0o444);
    assert.doesNotThrow(() => syncFile(file, { platform: "win32", open }));
    assert.deepEqual(flags, ["r+"]);

    chmodSync(file, 0o644);
    assert.throws(() => syncFile(file, { platform: "win32", open }), /EPERM/);
    openThrowing = () => {
      throw errno("ENOENT");
    };
    assert.throws(() => syncFile(file, { platform: "win32", open }), /ENOENT/);
  },
);

void test("win32 syncDirectory is a no-op", () => {
  const open = (() => {
    throw new Error("must not open");
  }) as never;
  assert.doesNotThrow(() =>
    syncDirectory("anywhere", { platform: "win32", open }),
  );
});

void test("renameWithRetrySync retries transient errors on win32 only", () => {
  let calls = 0;
  const sleeps: number[] = [];
  const flaky = (() => {
    if (++calls < 3) throw errno("EBUSY");
  }) as never;
  renameWithRetrySync("a", "b", {
    platform: "win32",
    rename: flaky,
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);

  calls = 0;
  const fatal = (() => {
    calls++;
    throw errno("ENOENT");
  }) as never;
  assert.throws(
    () => renameWithRetrySync("a", "b", { platform: "win32", rename: fatal }),
    /ENOENT/,
  );
  assert.equal(calls, 1);

  calls = 0;
  const busy = (() => {
    calls++;
    throw errno("EBUSY");
  }) as never;
  assert.throws(
    () => renameWithRetrySync("a", "b", { platform: "linux", rename: busy }),
    /EBUSY/,
  );
  assert.equal(calls, 1);
});

void test("restoreSymlink falls back to a junction or explains the privilege", (t) => {
  const root = directory(t);
  const calls: unknown[][] = [];
  const denied = ((...args: unknown[]) => {
    calls.push(args);
    if (args.length < 3) throw errno("EPERM");
  }) as never;
  restoreSymlink(".", join(root, "link"), "win32", denied);
  assert.equal(calls.at(-1)?.[2], "junction");
  assert.throws(
    () => restoreSymlink("missing.txt", join(root, "link2"), "win32", denied),
    /Developer Mode/,
  );
});

void test("rollback restores file bytes and mode", posixOnly, (t) => {
  const root = directory(t);
  const target = join(root, "settings.json");
  writeFileSync(target, "original", { mode: 0o444 });
  const journal = new RollbackJournal(join(root, "scratch"));
  journal.preserveFile(target);
  rmSync(target, { force: true });
  writeFileSync(target, "changed");
  journal.restore();
  assert.equal(readFileSync(target, "utf8"), "original");
  assert.equal(statSync(target).mode & 0o777, 0o444);
});
