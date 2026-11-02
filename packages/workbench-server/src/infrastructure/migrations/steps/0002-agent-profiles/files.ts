import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  syncFile,
  syncDirectory,
  renameWithRetrySync,
} from "../../framework/durability.js";
import { dirname, resolve } from "node:path";
import type { StepContext } from "../../framework/step.js";

export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function safePath(path: string): void {
  for (let entry = resolve(path); ; entry = dirname(entry)) {
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    assert(!stat?.isSymbolicLink(), `Symlinked migration path: ${entry}`);
    if (entry === dirname(entry)) break;
  }
}
export function readText(path: string): string {
  safePath(path);
  assert(lstatSync(path).isFile(), `Expected regular file: ${path}`);
  const bytes = readFileSync(path),
    text = bytes.toString("utf8");
  assert(
    Buffer.from(text, "utf8").equals(bytes),
    `Non-UTF8 migration source: ${path}`,
  );
  return text;
}
export function json(path: string): unknown {
  return JSON.parse(readText(path));
}
/** Originals/receipts outlive step rollback and scratch cleanup. Never use this
 * writer for authoritative target files (those belong in the rollback journal). */
export function writeProtected(path: string, bytes: string | Uint8Array): void {
  const created = missingParents(path);
  safePath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.migration-write`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    syncFile(temporary);
    renameWithRetrySync(temporary, path);
    syncDirectory(dirname(path));
    for (const directory of created) syncDirectory(dirname(directory));
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function writeJson(
  ctx: StepContext,
  path: string,
  document: unknown,
): void {
  safePath(path);
  ctx.fs.write(path, JSON.stringify(document, null, 2) + "\n");
}

function missingParents(path: string): string[] {
  const created: string[] = [];
  for (
    let directory = dirname(path);
    !lstatSync(directory, { throwIfNoEntry: false });
    directory = dirname(directory)
  ) {
    if (directory === dirname(directory))
      throw new Error("Missing filesystem root");
    created.push(directory);
  }
  return created;
}
export function withDurableParents(path: string, write: () => void): void {
  const created = missingParents(path);
  write();
  for (const directory of created) syncDirectory(dirname(directory));
}
