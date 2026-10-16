import { randomUUID } from "node:crypto";
import { syncDirectory, syncFile } from "./durability.js";
import { movePreservingSource } from "./move.js";
import assert from "node:assert/strict";
import {
  closeSync,
  openSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { RollbackJournal, setUnitJournal } from "./rollback-journal.js";

/** Write-ahead original state plus a transient journal for the current unit. */
export class MigrationFilesystem {
  readOnly = false;
  #unit: RollbackJournal | undefined;
  constructor(private readonly scratchDir: string) {}
  private journals(): RollbackJournal[] {
    assert(!this.readOnly, "The migration check phase is read-only");
    return [
      new RollbackJournal(this.scratchDir),
      ...(this.#unit ? [this.#unit] : []),
    ];
  }
  recoverUnit(): void {
    const pending = join(this.scratchDir, "pending-unit");
    if (!existsSync(pending)) return;
    if (!existsSync(join(pending, "committed")))
      new RollbackJournal(pending).restore();
    setUnitJournal(undefined);
    rmSync(pending, { recursive: true, force: true });
    syncDirectory(this.scratchDir);
  }
  beginUnit(): { finish(success: boolean): void } {
    assert(!this.#unit, "Nested migration units are not supported");
    if (this.readOnly) return { finish() {} };
    const pending = join(this.scratchDir, "pending-unit");
    const journal = new RollbackJournal(pending);
    this.#unit = journal;
    setUnitJournal(journal);
    return {
      finish: (success) => {
        try {
          if (!success) journal.restore();
          else {
            const marker = join(pending, "committed");
            writeFileSync(marker, "", { mode: 0o600 });
            syncFile(marker);
            syncDirectory(pending);
          }
        } finally {
          this.#unit = undefined;
          setUnitJournal(undefined);
        }
        rmSync(pending, { recursive: true, force: true });
        syncDirectory(this.scratchDir);
      },
    };
  }
  write(path: string, content: string | Uint8Array): void {
    this.writeChunks(path, [content]);
  }
  writeChunks(path: string, chunks: Iterable<string | Uint8Array>): void {
    for (const journal of this.journals()) journal.preserveFile(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.migration-write`;
    for (const journal of this.journals()) journal.preserveFile(temporary);
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        for (const chunk of chunks) writeFileSync(fd, chunk);
      } finally {
        closeSync(fd);
      }
      syncFile(temporary);
      renameSync(temporary, path);
      syncDirectory(dirname(path));
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  rename(from: string, to: string): void {
    assert(
      lstatSync(from, { throwIfNoEntry: false }),
      `Missing rename source ${from}`,
    );
    assert(
      !lstatSync(to, { throwIfNoEntry: false }),
      `Destination already exists: ${to}`,
    );
    for (const journal of this.journals()) journal.recordRename(from, to);
    renameSync(from, to);
  }
  move(from: string, to: string): void {
    if (!lstatSync(from, { throwIfNoEntry: false })) {
      assert(
        lstatSync(to, { throwIfNoEntry: false }),
        `Missing move source ${from}`,
      );
      return;
    }
    for (const journal of this.journals()) journal.recordRename(from, to);
    movePreservingSource(from, to);
  }
  remove(path: string): void {
    this.journals();
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      // Removing a directory is a reversible move, not a recursive snapshot.
      const retained = join(
        this.scratchDir,
        "removed",
        String(Date.now()) + "-" + Math.random().toString(36).slice(2),
      );
      mkdirSync(dirname(retained), { recursive: true, mode: 0o700 });
      this.move(path, retained);
    } else {
      for (const journal of this.journals()) journal.preserveFile(path);
      rmSync(path, { force: true });
    }
  }
  mkdir(path: string): void {
    const missing: string[] = [];
    for (let p = path; !existsSync(p) && p !== dirname(p); p = dirname(p))
      missing.push(p);
    for (const p of missing.reverse()) {
      for (const journal of this.journals()) journal.snapshotDirectory(p);
      mkdirSync(p, { recursive: true, mode: 0o700 });
    }
    if (!missing.length)
      for (const journal of this.journals()) journal.snapshotDirectory(path);
  }
}
