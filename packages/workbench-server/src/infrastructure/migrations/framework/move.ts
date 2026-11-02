import { renameWithRetrySync, syncDirectory, syncFile } from "./durability.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

const REMOVE_RETRY = { maxRetries: 5, retryDelay: 50 };
const present = (path: string) => !!lstatSync(path, { throwIfNoEntry: false });

function digest(path: string): string {
  const hash = createHash("sha256");
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      hash.update(`link:${readlinkSync(path)}`);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        hash.update(`entry:${name.length}:${name}`);
        visit(join(path, name));
      }
      return;
    }
    hash.update(`file:${stat.size}:`);
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let count: number;
      while ((count = readSync(fd, buffer)) > 0)
        hash.update(buffer.subarray(0, count));
    } finally {
      closeSync(fd);
    }
  };
  visit(path);
  return hash.digest("hex");
}
function syncTree(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) syncTree(join(path, name));
    syncDirectory(path);
    return;
  }
  syncFile(path);
}
/** Rename first; across devices publish only a completely synced copy before removing source. */
export function movePreservingSource(from: string, to: string): void {
  if (!present(from)) {
    assert(present(to), `Missing move source ${from}`);
    return;
  }
  if (present(to)) {
    assert.equal(
      digest(from),
      digest(to),
      `Conflicting move destination ${to}`,
    );
    rmSync(from, { recursive: true, force: true, ...REMOVE_RETRY });
    syncDirectory(dirname(from));
    return;
  }
  try {
    renameWithRetrySync(from, to);
    syncDirectory(dirname(from));
    syncDirectory(dirname(to));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const temporary = `${to}.copying`;
    rmSync(temporary, { recursive: true, force: true, ...REMOVE_RETRY });
    cpSync(from, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    syncTree(temporary);
    renameWithRetrySync(temporary, to);
    syncDirectory(dirname(to));
    rmSync(from, { recursive: true, force: true, ...REMOVE_RETRY });
    syncDirectory(dirname(from));
  }
}
